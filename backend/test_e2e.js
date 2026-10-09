const BASE = 'http://localhost:8000';

async function testSuite() {
  console.log('--- Starting TRACE E2E Verification ---');
  let failures = 0;
  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      failures++;
    } else {
      console.log(`✅ PASS: ${message}`);
    }
  }

  // 1. Health check
  const healthRes = await fetch(`${BASE}/health`);
  const healthData = await healthRes.json();
  assert(healthRes.status === 200 && healthData.ok === true, 'GET /health returns ok');

  // 2. Auth login
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'officer@trace.demo', password: 'TraceDemo!2026' })
  });
  const loginData = await loginRes.json();
  assert(loginRes.status === 200 && !!loginData.accessToken, 'POST /auth/login officer succeeds');
  const officerToken = loginData.accessToken;

  // 2b. Supervisor login
  const supLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'supervisor@trace.demo', password: 'TraceDemo!2026' })
  });
  const supData = await supLogin.json();
  assert(supLogin.status === 200 && supData.user.role === 'SUPERVISOR', 'POST /auth/login supervisor succeeds');
  const supervisorToken = supData.accessToken;

  // 2c. Admin login
  const adminLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@trace.demo', password: 'TraceDemo!2026' })
  });
  const adminData = await adminLogin.json();
  assert(adminLogin.status === 200 && adminData.user.role === 'ADMIN', 'POST /auth/login admin succeeds');
  const adminToken = adminData.accessToken;

  // 3. Auth /me
  const meRes = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  const meData = await meRes.json();
  assert(meRes.status === 200 && meData.user.email === 'officer@trace.demo', 'GET /auth/me returns current user');

  // 4. Role gate check: officer cannot access /users, admin can
  const officerUsersRes = await fetch(`${BASE}/users`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerUsersRes.status === 403, 'GET /users returns 403 Forbidden for FIELD_OFFICER');

  const adminUsersRes = await fetch(`${BASE}/users`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const adminUsersData = await adminUsersRes.json();
  assert(adminUsersRes.status === 200 && Array.isArray(adminUsersData.users), 'GET /users returns users array for ADMIN');

  // 5. System dashboard & health
  const dashRes = await fetch(`${BASE}/system/dashboard`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  const dashData = await dashRes.json();
  assert(dashRes.status === 200 && dashData.overview !== undefined, 'GET /system/dashboard returns overview metrics');

  const sysHealthRes = await fetch(`${BASE}/system/health`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  const sysHealthData = await sysHealthRes.json();
  assert(sysHealthRes.status === 200 && sysHealthData.crypto !== undefined, 'GET /system/health returns system info');

  // 6. Profiles
  const profRes = await fetch(`${BASE}/profiles`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  const profData = await profRes.json();
  assert(profRes.status === 200 && profData.profiles.length > 0, 'GET /profiles returns profiles');
  const profile = profData.profiles[0];

  // 7. Create Test
  const createTestRes = await fetch(`${BASE}/tests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officerToken}`
    },
    body: JSON.stringify({
      profileSlug: profile.slug,
      demoScenario: 'positive',
      locationLabel: 'Checkpoint Alpha'
    })
  });
  const testData = await createTestRes.json();
  assert(createTestRes.status === 201 && testData.test?.testId, 'POST /tests creates test');
  const testId = testData.test.testId;

  // 8. Capture - simulate poor-capture quality rejection
  const captureRejectRes = await fetch(`${BASE}/tests/${testId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${officerToken}`
    },
    body: new URLSearchParams({ demoScenario: 'poor-capture', failQuality: 'true' })
  });
  const captureRejectData = await captureRejectRes.json();
  assert(captureRejectRes.status === 200 && captureRejectData.accepted === false, 'POST /tests/:id/capture handles quality reject');

  // 9. Capture - simulate valid positive capture
  const captureAcceptRes = await fetch(`${BASE}/tests/${testId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${officerToken}`
    },
    body: new URLSearchParams({ demoScenario: 'positive' })
  });
  const captureAcceptData = await captureAcceptRes.json();
  assert(captureAcceptRes.status === 200 && captureAcceptData.accepted === true, 'POST /tests/:id/capture accepts quality capture');

  // 10. Analyze test
  const analyzeRes = await fetch(`${BASE}/tests/${testId}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officerToken}`
    },
    body: JSON.stringify({ demoScenario: 'positive' })
  });
  const analyzeData = await analyzeRes.json();
  assert(analyzeRes.status === 200 && analyzeData.evidence?.result === 'POSITIVE', 'POST /tests/:id/analyze generates POSITIVE result and evidence');
  const evidence = analyzeData.evidence;
  const evidenceId = evidence.evidenceId;

  // 11. Cryptographic integrity of newly created evidence
  assert(!!evidence.hash && !!evidence.signature, 'Evidence contains SHA-256 hash and Ed25519 signature');

  // 12. Fetch evidence by ID
  const evRes = await fetch(`${BASE}/evidence/${evidenceId}`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  const evData = await evRes.json();
  assert(evRes.status === 200 && evData.evidence.evidenceId === evidenceId, 'GET /evidence/:id retrieves evidence record');
  assert(Array.isArray(evData.audit) && evData.audit.length >= 8, 'Evidence record includes audit timeline');

  // 13. Verify evidence via /evidence/:id/verify
  const evVerifyRes = await fetch(`${BASE}/evidence/${evidenceId}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  const evVerifyData = await evVerifyRes.json();
  assert(evVerifyRes.status === 200 && evVerifyData.verified === true && evVerifyData.integrity === 'VALID', 'POST /evidence/:id/verify validates cryptographic integrity');

  // 14. Verify via /verify endpoint with token
  const verifyTokenRes = await fetch(`${BASE}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officerToken}`
    },
    body: JSON.stringify({ verificationToken: evidence.verificationToken })
  });
  const verifyTokenData = await verifyTokenRes.json();
  assert(verifyTokenRes.status === 200 && verifyTokenData.verified === true, 'POST /verify validates via verificationToken (QR)');

  // 15. Audit trail endpoint
  const auditRes = await fetch(`${BASE}/audit/${evidenceId}`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  const auditData = await auditRes.json();
  assert(auditRes.status === 200 && auditData.events.length > 0, 'GET /audit/:id retrieves audit trail');

  // 16. Supervisor Countersigning
  const signRes = await fetch(`${BASE}/evidence/${evidenceId}/sign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${supervisorToken}` }
  });
  const signData = await signRes.json();
  assert(signRes.status === 200 && signData.ok === true && signData.evidence?.countersigned === true, 'POST /evidence/:id/sign supervisor countersigns record');

  // 17. Officer Forbidden from Countersigning
  const officerSignRes = await fetch(`${BASE}/evidence/${evidenceId}/sign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerSignRes.status === 403, 'POST /evidence/:id/sign forbids FIELD_OFFICER');

  // 18. Tamper Detection via /verify endpoint
  const tamperedPackage = {
    evidenceId: evidence.evidenceId,
    result: 'NEGATIVE', // Tampered! Original was POSITIVE
    confidence: evidence.confidence,
    createdAt: evidence.createdAt,
    operatorId: evidence.operatorId,
    profileSlug: evidence.profile?.slug || 'field-test-a',
    analysisVersion: evidence.analysisVersion || 'trace-vision-1.0-demo',
    hash: evidence.hash,
  };
  const tamperVerifyRes = await fetch(`${BASE}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officerToken}`,
    },
    body: JSON.stringify({ package: tamperedPackage })
  });
  const tamperVerifyData = await tamperVerifyRes.json();
  assert(tamperVerifyRes.status === 409 && tamperVerifyData.verified === false && tamperVerifyData.integrity === 'TAMPERED', 'POST /verify detects tampered package cryptographically');

  // 19. Offline Ingestion via /system/sync
  const offlineEvId = `TRC-OFFLINE-${Date.now().toString(16).toUpperCase()}`;
  const offlinePayload = {
    evidenceId: offlineEvId,
    result: 'POSITIVE',
    confidence: 0.95,
    createdAt: new Date().toISOString(),
    operatorId: 'offline-officer',
    profileSlug: 'field-test-a',
    analysisVersion: 'trace-vision-1.0-demo',
  };
  const syncRes = await fetch(`${BASE}/system/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${officerToken}`,
    },
    body: JSON.stringify({
      records: [
        {
          evidenceId: offlineEvId,
          result: 'POSITIVE',
          confidence: 0.95,
          operatorName: 'Asha Menon',
          packagePayload: offlinePayload,
        }
      ]
    })
  });
  const syncData = await syncRes.json();
  assert(syncRes.status === 200 && syncData.synchronized >= 1, 'POST /system/sync ingests offline evidence');

  // Verify the synced record is now accessible in evidence vault
  const syncedEvRes = await fetch(`${BASE}/evidence/${offlineEvId}`, {
    headers: { Authorization: `Bearer ${supervisorToken}` }
  });
  const syncedEvData = await syncedEvRes.json();
  assert(syncedEvRes.status === 200 && syncedEvData.evidence.evidenceId === offlineEvId, 'Synced offline record is retrievable from evidence vault');

  // 20. Profile Status Update (Admin)
  const patchProfileRes = await fetch(`${BASE}/profiles/${profile.slug}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: 'Draft' })
  });
  const patchProfileData = await patchProfileRes.json();
  assert(patchProfileRes.status === 200 && patchProfileData.profile.status === 'Draft', 'PATCH /profiles/:slug updates profile status to Draft');

  // Restore back to Active
  await fetch(`${BASE}/profiles/${profile.slug}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: 'Active' })
  });

  // 21. User Management (Admin)
  const officerUser = adminUsersData.users.find(u => u.role === 'FIELD_OFFICER');
  if (officerUser) {
    const patchUserRes = await fetch(`${BASE}/users/${officerUser.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ unit: 'Special Field Unit' })
    });
    const patchUserData = await patchUserRes.json();
    assert(patchUserRes.status === 200 && patchUserData.user.unit === 'Special Field Unit', 'PATCH /users/:id updates user unit');
  }

  // Admin cannot disable own account
  const selfAdmin = adminUsersData.users.find(u => u.role === 'ADMIN');
  if (selfAdmin) {
    const selfDisableRes = await fetch(`${BASE}/users/${selfAdmin.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ active: false })
    });
    assert(selfDisableRes.status === 400, 'PATCH /users/:id prevents admin from self-disabling');
  }

  console.log(`\n--- Completed with ${failures} failure(s) ---`);
  process.exit(failures > 0 ? 1 : 0);
}

testSuite().catch((err) => {
  console.error('Fatal error during test suite:', err);
  process.exit(1);
});
