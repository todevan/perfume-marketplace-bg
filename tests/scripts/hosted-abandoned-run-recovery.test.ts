import { describe, expect, it } from 'vitest';

describe('abandoned Gate 3 recovery cleanup', () => {
  it('rejects a manifest outside the exact abandoned-run target before recovery inspection', async () => {
    const moduleUrl = new URL(
      '../../scripts/hosted-abandoned-run-recovery.mjs',
      import.meta.url
    ).href;

    const recoveryModule = await import(moduleUrl).catch(() => null);

    if (!recoveryModule) {
      expect(
        recoveryModule,
        'recovery module must exist before abandoned-run cleanup can be validated'
      ).not.toBeNull();
      return;
    }

    expect(typeof recoveryModule.validateAbandonedRecoveryManifest).toBe('function');

    const manifest = {
      targetProjectRef: 'foreign-project-ref',
      runId: 'gate3-587a06c3fe49',
      provisioningAttemptId: '11111111-1111-4111-8111-111111111111',
      credentialStoreId: '0'.repeat(64),
      pendingActors: [],
      actors: [],
      reports: [],
      uploads: [],
      queueRows: []
    };

    expect(() =>
      recoveryModule.validateAbandonedRecoveryManifest({
        manifest,
        expectedRunId: 'gate3-587a06c3fe49',
        expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
      })
    ).toThrow(/recovery manifest target does not match approved abandoned run/u);
  });
});

  it('rejects an abandoned manifest without exactly four unique actors', async () => {
    const {
      validateAbandonedRecoveryManifest
    } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

    const manifest = {
      targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
      runId: 'gate3-587a06c3fe49',
      provisioningAttemptId: '11111111-1111-4111-8111-111111111111',
      credentialStoreId: '0'.repeat(64),
      pendingActors: [],
      actors: [
        {
          role: 'actor-one',
          userId: '11111111-1111-4111-8111-111111111112',
          createdAt: '2026-08-18T12:00:00.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        },
        {
          role: 'actor-two',
          userId: '11111111-1111-4111-8111-111111111113',
          createdAt: '2026-08-18T12:00:01.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        },
        {
          role: 'actor-three',
          userId: '11111111-1111-4111-8111-111111111114',
          createdAt: '2026-08-18T12:00:02.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        }
      ],
      reports: [],
      uploads: [],
      queueRows: []
    };

    expect(() =>
      validateAbandonedRecoveryManifest({
        manifest,
        expectedRunId: 'gate3-587a06c3fe49',
        expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
      })
    ).toThrow(/exactly four unique actors/u);
  });

  it('rejects four actors when their user IDs are not unique', async () => {
    const {
      validateAbandonedRecoveryManifest
    } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

    const duplicateUserId = '11111111-1111-4111-8111-111111111112';

    const manifest = {
      targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
      runId: 'gate3-587a06c3fe49',
      provisioningAttemptId: '11111111-1111-4111-8111-111111111111',
      credentialStoreId: '0'.repeat(64),
      pendingActors: [],
      actors: [
        {
          role: 'actor-one',
          userId: duplicateUserId,
          createdAt: '2026-08-18T12:00:00.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        },
        {
          role: 'actor-two',
          userId: duplicateUserId,
          createdAt: '2026-08-18T12:00:01.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        },
        {
          role: 'actor-three',
          userId: '11111111-1111-4111-8111-111111111114',
          createdAt: '2026-08-18T12:00:02.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        },
        {
          role: 'actor-four',
          userId: '11111111-1111-4111-8111-111111111115',
          createdAt: '2026-08-18T12:00:03.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        }
      ],
      reports: [],
      uploads: [],
      queueRows: []
    };

    expect(() =>
      validateAbandonedRecoveryManifest({
        manifest,
        expectedRunId: 'gate3-587a06c3fe49',
        expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
      })
    ).toThrow(/exactly four unique actors/u);
  });

  it('rejects a manifest with pending actors before recovery inspection', async () => {
    const {
      validateAbandonedRecoveryManifest
    } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

    const manifest = {
      targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
      runId: 'gate3-587a06c3fe49',
      provisioningAttemptId: '11111111-1111-4111-8111-111111111111',
      credentialStoreId: '0'.repeat(64),
      pendingActors: [
        {
          role: 'pending-actor',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        }
      ],
      actors: [
        {
          role: 'actor-one',
          userId: '11111111-1111-4111-8111-111111111112',
          createdAt: '2026-08-18T12:00:00.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        },
        {
          role: 'actor-two',
          userId: '11111111-1111-4111-8111-111111111113',
          createdAt: '2026-08-18T12:00:01.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        },
        {
          role: 'actor-three',
          userId: '11111111-1111-4111-8111-111111111114',
          createdAt: '2026-08-18T12:00:02.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        },
        {
          role: 'actor-four',
          userId: '11111111-1111-4111-8111-111111111115',
          createdAt: '2026-08-18T12:00:03.000Z',
          provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
        }
      ],
      reports: [],
      uploads: [],
      queueRows: []
    };

    expect(() =>
      validateAbandonedRecoveryManifest({
        manifest,
        expectedRunId: 'gate3-587a06c3fe49',
        expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
      })
    ).toThrow(/pending actors/u);
  });

it('rejects an abandoned manifest with an invalid provisioning attempt ID', async () => {
  const {
    validateAbandonedRecoveryManifest
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: 'not-a-uuid',
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors: [
      {
        role: 'actor-one',
        userId: '11111111-1111-4111-8111-111111111112',
        createdAt: '2026-08-18T12:00:00.000Z',
        provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
      },
      {
        role: 'actor-two',
        userId: '11111111-1111-4111-8111-111111111113',
        createdAt: '2026-08-18T12:00:01.000Z',
        provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
      },
      {
        role: 'actor-three',
        userId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-18T12:00:02.000Z',
        provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
      },
      {
        role: 'actor-four',
        userId: '11111111-1111-4111-8111-111111111115',
        createdAt: '2026-08-18T12:00:03.000Z',
        provisioningAttemptId: '11111111-1111-4111-8111-111111111111'
      }
    ],
    reports: [],
    uploads: [],
    queueRows: []
  };

  expect(() =>
    validateAbandonedRecoveryManifest({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
    })
  ).toThrow(/provisioning attempt ID/u);
});

it('rejects an actor whose provisioning attempt does not match the manifest binding', async () => {
  const {
    validateAbandonedRecoveryManifest
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors: [
      {
        role: 'actor-one',
        userId: '11111111-1111-4111-8111-111111111112',
        createdAt: '2026-08-18T12:00:00.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-two',
        userId: '11111111-1111-4111-8111-111111111113',
        createdAt: '2026-08-18T12:00:01.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-three',
        userId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-18T12:00:02.000Z',
        provisioningAttemptId: '22222222-2222-4222-8222-222222222222'
      },
      {
        role: 'actor-four',
        userId: '11111111-1111-4111-8111-111111111115',
        createdAt: '2026-08-18T12:00:03.000Z',
        provisioningAttemptId: manifestAttempt
      }
    ],
    reports: [],
    uploads: [],
    queueRows: []
  };

  expect(() =>
    validateAbandonedRecoveryManifest({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
    })
  ).toThrow(/actor provisioning attempt does not match manifest binding/u);
});

it('rejects an actor with an invalid manifest user ID', async () => {
  const {
    validateAbandonedRecoveryManifest
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors: [
      {
        role: 'actor-one',
        userId: 'not-a-uuid',
        createdAt: '2026-08-18T12:00:00.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-two',
        userId: '11111111-1111-4111-8111-111111111113',
        createdAt: '2026-08-18T12:00:01.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-three',
        userId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-18T12:00:02.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-four',
        userId: '11111111-1111-4111-8111-111111111115',
        createdAt: '2026-08-18T12:00:03.000Z',
        provisioningAttemptId: manifestAttempt
      }
    ],
    reports: [],
    uploads: [],
    queueRows: []
  };

  expect(() =>
    validateAbandonedRecoveryManifest({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
    })
  ).toThrow(/actor user ID is invalid/u);
});


it('rejects an actor with an invalid provisioning timestamp', async () => {
  const {
    validateAbandonedRecoveryManifest
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors: [
      {
        role: 'actor-one',
        userId: '11111111-1111-4111-8111-111111111112',
        createdAt: 'not-a-timestamp',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-two',
        userId: '11111111-1111-4111-8111-111111111113',
        createdAt: '2026-08-18T12:00:01.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-three',
        userId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-18T12:00:02.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-four',
        userId: '11111111-1111-4111-8111-111111111115',
        createdAt: '2026-08-18T12:00:03.000Z',
        provisioningAttemptId: manifestAttempt
      }
    ],
    reports: [],
    uploads: [],
    queueRows: []
  };

  expect(() =>
    validateAbandonedRecoveryManifest({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
    })
  ).toThrow(/actor provisioning timestamp is invalid/u);
});

it('rejects an invalid credential store binding', async () => {
  const {
    validateAbandonedRecoveryManifest
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: 'not-a-valid-store-id',
    pendingActors: [],
    actors: [
      {
        role: 'actor-one',
        userId: '11111111-1111-4111-8111-111111111112',
        createdAt: '2026-08-18T12:00:00.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-two',
        userId: '11111111-1111-4111-8111-111111111113',
        createdAt: '2026-08-18T12:00:01.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-three',
        userId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-18T12:00:02.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-four',
        userId: '11111111-1111-4111-8111-111111111115',
        createdAt: '2026-08-18T12:00:03.000Z',
        provisioningAttemptId: manifestAttempt
      }
    ],
    reports: [],
    uploads: [],
    queueRows: []
  };

  expect(() =>
    validateAbandonedRecoveryManifest({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
    })
  ).toThrow(/credential store binding is invalid/u);
});

it('rejects a dry-run inventory containing foreign artifacts', async () => {
  const recoveryModule = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  expect(typeof recoveryModule.assessAbandonedRecoveryDryRun).toBe('function');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors: [
      {
        role: 'actor-one',
        userId: '11111111-1111-4111-8111-111111111112',
        createdAt: '2026-08-18T12:00:00.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-two',
        userId: '11111111-1111-4111-8111-111111111113',
        createdAt: '2026-08-18T12:00:01.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-three',
        userId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-18T12:00:02.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-four',
        userId: '11111111-1111-4111-8111-111111111115',
        createdAt: '2026-08-18T12:00:03.000Z',
        provisioningAttemptId: manifestAttempt
      }
    ],
    reports: [],
    uploads: [],
    queueRows: []
  };

  expect(() =>
    recoveryModule.assessAbandonedRecoveryDryRun({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp',
      inventory: {
        accounts: 4,
        pending: 0,
        reports: 0,
        uploads: 0,
        objects: 0,
        queueRows: 0,
        foreignArtifacts: 1,
        preExistingAccounts: 0
      }
    })
  ).toThrow(/recovery scope is not isolated/u);
});

it('rejects a dry-run when any existing actor fails exact provenance attestation', async () => {
  const {
    assessAbandonedRecoveryDryRun
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const actors = [
    {
      role: 'actor-one',
      userId: '11111111-1111-4111-8111-111111111112',
      createdAt: '2026-08-18T12:00:00.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-two',
      userId: '11111111-1111-4111-8111-111111111113',
      createdAt: '2026-08-18T12:00:01.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-three',
      userId: '11111111-1111-4111-8111-111111111114',
      createdAt: '2026-08-18T12:00:02.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-four',
      userId: '11111111-1111-4111-8111-111111111115',
      createdAt: '2026-08-18T12:00:03.000Z',
      provisioningAttemptId: manifestAttempt
    }
  ];

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors,
    reports: [],
    uploads: [],
    queueRows: []
  };

  const attestations = actors.map((actor, index) => ({
    userId: actor.userId,
    exists: true,
    createdAt: actor.createdAt,
    runId: 'gate3-587a06c3fe49',
    provisioningNonce: manifestAttempt,
    provisioningAttemptId:
      index === 2
        ? '22222222-2222-4222-8222-222222222222'
        : manifestAttempt
  }));

  expect(() =>
    assessAbandonedRecoveryDryRun({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp',
      inventory: {
        accounts: 4,
        pending: 0,
        reports: 0,
        uploads: 0,
        objects: 0,
        queueRows: 0,
        foreignArtifacts: 0,
        preExistingAccounts: 0
      },
      actorAttestations: attestations
    })
  ).toThrow(/actor provenance is invalid/u);
});

it('rejects a dry-run when actor provenance attestations are missing', async () => {
  const {
    assessAbandonedRecoveryDryRun
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors: [
      {
        role: 'actor-one',
        userId: '11111111-1111-4111-8111-111111111112',
        createdAt: '2026-08-18T12:00:00.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-two',
        userId: '11111111-1111-4111-8111-111111111113',
        createdAt: '2026-08-18T12:00:01.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-three',
        userId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-18T12:00:02.000Z',
        provisioningAttemptId: manifestAttempt
      },
      {
        role: 'actor-four',
        userId: '11111111-1111-4111-8111-111111111115',
        createdAt: '2026-08-18T12:00:03.000Z',
        provisioningAttemptId: manifestAttempt
      }
    ],
    reports: [],
    uploads: [],
    queueRows: []
  };

  expect(() =>
    assessAbandonedRecoveryDryRun({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp',
      inventory: {
        accounts: 4,
        pending: 0,
        reports: 0,
        uploads: 0,
        objects: 0,
        queueRows: 0,
        foreignArtifacts: 0,
        preExistingAccounts: 0
      }
    })
  ).toThrow(/actor provenance attestations are required/u);
});

it('deletes only the exact manifest actor IDs after a successful dry-run', async () => {
  const recoveryModule = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  expect(typeof recoveryModule.executeAbandonedRecoveryCleanup).toBe('function');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const actors = [
    {
      role: 'actor-one',
      userId: '11111111-1111-4111-8111-111111111112',
      createdAt: '2026-08-18T12:00:00.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-two',
      userId: '11111111-1111-4111-8111-111111111113',
      createdAt: '2026-08-18T12:00:01.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-three',
      userId: '11111111-1111-4111-8111-111111111114',
      createdAt: '2026-08-18T12:00:02.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-four',
      userId: '11111111-1111-4111-8111-111111111115',
      createdAt: '2026-08-18T12:00:03.000Z',
      provisioningAttemptId: manifestAttempt
    }
  ];

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors,
    reports: [],
    uploads: [],
    queueRows: []
  };

  const actorAttestations = actors.map((actor) => ({
    userId: actor.userId,
    exists: true,
    createdAt: actor.createdAt,
    runId: 'gate3-587a06c3fe49',
    provisioningNonce: manifestAttempt,
    provisioningAttemptId: manifestAttempt
  }));

  const deletedActorIds: string[] = [];

  const result = await recoveryModule.executeAbandonedRecoveryCleanup({
    manifest,
    expectedRunId: 'gate3-587a06c3fe49',
    expectedProjectRef: 'nuhkpqjjyuygiemrxbdp',
    inventory: {
      accounts: 4,
      pending: 0,
      reports: 0,
      uploads: 0,
      objects: 0,
      queueRows: 0,
      foreignArtifacts: 0,
      preExistingAccounts: 0
    },
    actorAttestations,
    deleteActorById: async (userId: string) => {
      deletedActorIds.push(userId);
    },
    inspectAfterCleanup: async () => ({
      accounts: 0,
      pending: 0,
      reports: 0,
      uploads: 0,
      objects: 0,
      queueRows: 0,
      foreignArtifacts: 0,
      preExistingAccounts: 0
    })
  });

  expect(deletedActorIds).toEqual(actors.map((actor) => actor.userId));
  expect(result.deletedActorCount).toBe(4);
});

it('does not report cleanup success until post-delete inspection is verified zero', async () => {
  const {
    executeAbandonedRecoveryCleanup
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const actors = [
    {
      role: 'actor-one',
      userId: '11111111-1111-4111-8111-111111111112',
      createdAt: '2026-08-18T12:00:00.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-two',
      userId: '11111111-1111-4111-8111-111111111113',
      createdAt: '2026-08-18T12:00:01.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-three',
      userId: '11111111-1111-4111-8111-111111111114',
      createdAt: '2026-08-18T12:00:02.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-four',
      userId: '11111111-1111-4111-8111-111111111115',
      createdAt: '2026-08-18T12:00:03.000Z',
      provisioningAttemptId: manifestAttempt
    }
  ];

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors,
    reports: [],
    uploads: [],
    queueRows: []
  };

  const actorAttestations = actors.map((actor) => ({
    userId: actor.userId,
    exists: true,
    createdAt: actor.createdAt,
    runId: 'gate3-587a06c3fe49',
    provisioningNonce: manifestAttempt,
    provisioningAttemptId: manifestAttempt
  }));

  await expect(
    executeAbandonedRecoveryCleanup({
      manifest,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp',
      inventory: {
        accounts: 4,
        pending: 0,
        reports: 0,
        uploads: 0,
        objects: 0,
        queueRows: 0,
        foreignArtifacts: 0,
        preExistingAccounts: 0
      },
      actorAttestations,
      deleteActorById: async () => {},
      inspectAfterCleanup: async () => ({
        accounts: 1,
        pending: 0,
        reports: 0,
        uploads: 0,
        objects: 0,
        queueRows: 0,
        foreignArtifacts: 0,
        preExistingAccounts: 0
      })
    })
  ).rejects.toThrow(/recovery cleanup verification found residual artifacts/u);
});


it('binds a recovery checkpoint to the exact manifest bytes', async () => {
  const recoveryModule = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  expect(typeof recoveryModule.createAbandonedRecoveryCheckpoint).toBe('function');
  expect(typeof recoveryModule.assertAbandonedRecoveryCheckpoint).toBe('function');

  const manifestBytes = new TextEncoder().encode(
    '{"targetProjectRef":"nuhkpqjjyuygiemrxbdp","runId":"gate3-587a06c3fe49"}\n'
  );

  const checkpoint = recoveryModule.createAbandonedRecoveryCheckpoint({
    manifestBytes,
    runId: 'gate3-587a06c3fe49',
    projectRef: 'nuhkpqjjyuygiemrxbdp',
    phase: 'dry-run-verified',
    counts: {
      accounts: 4,
      pending: 0,
      reports: 0,
      uploads: 0,
      objects: 0,
      queueRows: 0,
      foreignArtifacts: 0,
      preExistingAccounts: 0
    }
  });

  const changedManifestBytes = new TextEncoder().encode(
    '{"targetProjectRef":"nuhkpqjjyuygiemrxbdp","runId":"gate3-587a06c3fe49","changed":true}\n'
  );

  expect(() =>
    recoveryModule.assertAbandonedRecoveryCheckpoint({
      checkpoint,
      manifestBytes: changedManifestBytes,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
    })
  ).toThrow(/checkpoint does not match the exact recovery manifest/u);
});

it('creates a sanitized actor attestation from exact Auth metadata without actor credentials', async () => {
  const recoveryModule = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  expect(typeof recoveryModule.createAbandonedRecoverySupabaseAdapter).toBe('function');

  const userId = '11111111-1111-4111-8111-111111111112';
  const createdAt = '2026-08-18T12:00:00.000Z';
  const attempt = '11111111-1111-4111-8111-111111111111';

  const serviceClient = {
    auth: {
      admin: {
        getUserById: async (requestedId: string) => ({
          data: {
            user: {
              id: requestedId,
              created_at: createdAt,
              user_metadata: {
                gate3_report_evidence_run_id: 'gate3-587a06c3fe49',
                gate3_report_evidence_provisioning_nonce: attempt,
                gate3_report_evidence_provisioning_attempt_id: attempt
              }
            }
          },
          error: null
        })
      }
    }
  };

  const adapter = recoveryModule.createAbandonedRecoverySupabaseAdapter({
    serviceClient
  });

  await expect(adapter.inspectActor(userId)).resolves.toEqual({
    userId,
    exists: true,
    createdAt,
    runId: 'gate3-587a06c3fe49',
    provisioningNonce: attempt,
    provisioningAttemptId: attempt
  });
});

it('inspects inventory only for the exact manifest actor IDs', async () => {
  const recoveryModule = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const manifestAttempt = '11111111-1111-4111-8111-111111111111';

  const actors = [
    {
      role: 'actor-one',
      userId: '11111111-1111-4111-8111-111111111112',
      createdAt: '2026-08-18T12:00:00.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-two',
      userId: '11111111-1111-4111-8111-111111111113',
      createdAt: '2026-08-18T12:00:01.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-three',
      userId: '11111111-1111-4111-8111-111111111114',
      createdAt: '2026-08-18T12:00:02.000Z',
      provisioningAttemptId: manifestAttempt
    },
    {
      role: 'actor-four',
      userId: '11111111-1111-4111-8111-111111111115',
      createdAt: '2026-08-18T12:00:03.000Z',
      provisioningAttemptId: manifestAttempt
    }
  ];

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: manifestAttempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors,
    reports: [],
    uploads: [],
    queueRows: []
  };

  const requestedAuthIds: string[] = [];
  const requestedObjectPrefixes: string[] = [];

  const serviceClient = {
    auth: {
      admin: {
        getUserById: async (userId: string) => {
          requestedAuthIds.push(userId);
          return {
            data: {
              user: {
                id: userId,
                created_at: actors.find((actor) => actor.userId === userId)?.createdAt
              }
            },
            error: null
          };
        }
      }
    },

    from(table: string) {
      if (table === 'reports') {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null })
          })
        };
      }

      if (table === 'report_evidence_uploads') {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null })
          })
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },

    storage: {
      from(bucket: string) {
        expect(bucket).toBe('report-evidence');

        return {
          list: async (prefix: string) => {
            requestedObjectPrefixes.push(prefix);
            return { data: [], error: null };
          }
        };
      }
    }
  };

  const adapter = recoveryModule.createAbandonedRecoverySupabaseAdapter({
    serviceClient
  });

  await expect(adapter.inspectInventory(manifest)).resolves.toEqual({
    accounts: 4,
    pending: 0,
    reports: 0,
    uploads: 0,
    objects: 0,
    queueRows: 0,
    foreignArtifacts: 0,
    preExistingAccounts: 0
  });

  expect(requestedAuthIds).toEqual(actors.map((actor) => actor.userId));
  expect(requestedObjectPrefixes).toEqual(actors.map((actor) => actor.userId));
});

it('treats an exact manifest actor already missing from Auth as already cleaned', async () => {
  const recoveryModule = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const requestedIds: string[] = [];

  const serviceClient = {
    auth: {
      admin: {
        getUserById: async (userId: string) => {
          requestedIds.push(userId);
          return {
            data: { user: null },
            error: { status: 404 }
          };
        },
        deleteUser: async () => {
          throw new Error('deleteUser must not be called for an already-missing actor');
        }
      }
    }
  };

  const adapter = recoveryModule.createAbandonedRecoverySupabaseAdapter({
    serviceClient
  });

  const userId = '11111111-1111-4111-8111-111111111112';

  await expect(adapter.deleteActorById(userId)).resolves.toEqual({
    userId,
    deleted: false,
    alreadyMissing: true
  });

  expect(requestedIds).toEqual([userId]);
});


it('accepts A9 provenance when the run nonce is distinct from the manifest provisioning attempt', async () => {
  const {
    assessAbandonedRecoveryDryRun
  } = await import('../../scripts/hosted-abandoned-run-recovery.mjs');

  const runId = 'gate3-587a06c3fe49';
  const projectRef = 'nuhkpqjjyuygiemrxbdp';

  const provisioningAttemptId =
    '11111111-1111-4111-8111-111111111111';

  const provisioningNonce =
    '22222222-2222-4222-8222-222222222222';

  const actors = [
    {
      role: 'reporter',
      userId: '11111111-1111-4111-8111-111111111112',
      createdAt: '2026-08-18T12:00:00.000Z',
      provisioningAttemptId
    },
    {
      role: 'cross-user',
      userId: '11111111-1111-4111-8111-111111111113',
      createdAt: '2026-08-18T12:00:01.000Z',
      provisioningAttemptId
    },
    {
      role: 'assigned-moderator',
      userId: '11111111-1111-4111-8111-111111111114',
      createdAt: '2026-08-18T12:00:02.000Z',
      provisioningAttemptId
    },
    {
      role: 'unassigned-moderator',
      userId: '11111111-1111-4111-8111-111111111115',
      createdAt: '2026-08-18T12:00:03.000Z',
      provisioningAttemptId
    }
  ];

  const manifest = {
    targetProjectRef: projectRef,
    runId,
    provisioningAttemptId,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors,
    reports: [],
    uploads: [],
    queueRows: []
  };

  const actorAttestations = actors.map((actor) => ({
    userId: actor.userId,
    exists: true,
    createdAt: actor.createdAt,
    runId,
    provisioningNonce,
    provisioningAttemptId
  }));

  const inventory = {
    accounts: 4,
    pending: 0,
    reports: 0,
    uploads: 0,
    objects: 0,
    queueRows: 0,
    foreignArtifacts: 0,
    preExistingAccounts: 0
  };

  expect(() =>
    assessAbandonedRecoveryDryRun({
      manifest,
      expectedRunId: runId,
      expectedProjectRef: projectRef,
      inventory,
      actorAttestations
    })
  ).not.toThrow();
});
