import { describe, expect, it } from 'vitest';

describe('abandoned Gate 3 recovery runner', () => {
  it('produces only a sanitized dry-run receipt for the exact abandoned manifest', async () => {
    const runnerModule = await import(
      '../../scripts/hosted-abandoned-run-recovery-runner.mjs'
    ).catch(() => null);

    expect(
      runnerModule,
      'recovery runner must exist before dry-run execution can be validated'
    ).not.toBeNull();

    if (!runnerModule) return;

    expect(typeof runnerModule.runAbandonedRecoveryDryRun).toBe('function');

    const attempt = '11111111-1111-4111-8111-111111111111';

    const actors = [
      {
        role: 'actor-one',
        userId: '11111111-1111-4111-8111-111111111112',
        createdAt: '2026-08-18T12:00:00.000Z',
        provisioningAttemptId: attempt
      },
      {
        role: 'actor-two',
        userId: '11111111-1111-4111-8111-111111111113',
        createdAt: '2026-08-18T12:00:01.000Z',
        provisioningAttemptId: attempt
      },
      {
        role: 'actor-three',
        userId: '11111111-1111-4111-8111-111111111114',
        createdAt: '2026-08-18T12:00:02.000Z',
        provisioningAttemptId: attempt
      },
      {
        role: 'actor-four',
        userId: '11111111-1111-4111-8111-111111111115',
        createdAt: '2026-08-18T12:00:03.000Z',
        provisioningAttemptId: attempt
      }
    ];

    const manifest = {
      targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
      runId: 'gate3-587a06c3fe49',
      provisioningAttemptId: attempt,
      credentialStoreId: '0'.repeat(64),
      pendingActors: [],
      actors,
      reports: [],
      uploads: [],
      queueRows: []
    };

    const manifestBytes = new TextEncoder().encode(
      `${JSON.stringify(manifest)}\n`
    );

    const serviceClient = {
      auth: {
        admin: {
          getUserById: async (userId: string) => {
            const actor = actors.find((candidate) => candidate.userId === userId);

            return {
              data: {
                user: {
                  id: userId,
                  created_at: actor?.createdAt,
                  user_metadata: {
                    gate3_report_evidence_run_id: 'gate3-587a06c3fe49',
                    gate3_report_evidence_provisioning_nonce: attempt,
                    gate3_report_evidence_provisioning_attempt_id: attempt
                  }
                }
              },
              error: null
            };
          }
        }
      },

      from(table: string) {
        if (table === 'reports' || table === 'report_evidence_uploads') {
          return {
            select: () => ({
              in: async () => ({ data: [], error: null })
            })
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },

      storage: {
        from: () => ({
          list: async () => ({ data: [], error: null })
        })
      }
    };

    const receipt = await runnerModule.runAbandonedRecoveryDryRun({
      manifestBytes,
      serviceClient,
      expectedRunId: 'gate3-587a06c3fe49',
      expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
    });

    expect(receipt).toEqual({
      status: 'DRY_RUN_VERIFIED',
      runId: 'gate3-587a06c3fe49',
      projectRef: 'nuhkpqjjyuygiemrxbdp',
      actorCount: 4,
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

    expect(JSON.stringify(receipt)).not.toContain(
      '11111111-1111-4111-8111-111111111112'
    );
  });
});

  it('refuses cleanup before any delete without the exact recovery approval', async () => {
    const runnerModule = await import(
      '../../scripts/hosted-abandoned-run-recovery-runner.mjs'
    );

    expect(typeof runnerModule.runAbandonedRecoveryCleanup).toBe('function');

    let deleteCalls = 0;

    const serviceClient = {
      auth: {
        admin: {
          deleteUser: async () => {
            deleteCalls += 1;
            return { data: {}, error: null };
          }
        }
      }
    };

    await expect(
      runnerModule.runAbandonedRecoveryCleanup({
        approval: undefined,
        serviceClient
      })
    ).rejects.toThrow(/recovery cleanup approval is disabled/u);

    expect(deleteCalls).toBe(0);
  });

it('executes only the checkpoint-bound exact-manifest cleanup after explicit approval', async () => {
  const runnerModule = await import(
    '../../scripts/hosted-abandoned-run-recovery-runner.mjs'
  );
  const coreModule = await import(
    '../../scripts/hosted-abandoned-run-recovery.mjs'
  );

  const attempt = '11111111-1111-4111-8111-111111111111';

  const actors = [
    {
      role: 'actor-one',
      userId: '11111111-1111-4111-8111-111111111112',
      createdAt: '2026-08-18T12:00:00.000Z',
      provisioningAttemptId: attempt
    },
    {
      role: 'actor-two',
      userId: '11111111-1111-4111-8111-111111111113',
      createdAt: '2026-08-18T12:00:01.000Z',
      provisioningAttemptId: attempt
    },
    {
      role: 'actor-three',
      userId: '11111111-1111-4111-8111-111111111114',
      createdAt: '2026-08-18T12:00:02.000Z',
      provisioningAttemptId: attempt
    },
    {
      role: 'actor-four',
      userId: '11111111-1111-4111-8111-111111111115',
      createdAt: '2026-08-18T12:00:03.000Z',
      provisioningAttemptId: attempt
    }
  ];

  const manifest = {
    targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
    runId: 'gate3-587a06c3fe49',
    provisioningAttemptId: attempt,
    credentialStoreId: '0'.repeat(64),
    pendingActors: [],
    actors,
    reports: [],
    uploads: [],
    queueRows: []
  };

  const manifestBytes = new TextEncoder().encode(
    `${JSON.stringify(manifest)}\n`
  );

  const checkpoint = coreModule.createAbandonedRecoveryCheckpoint({
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

  const existingIds = new Set(actors.map((actor) => actor.userId));
  const deletedIds: string[] = [];

  const serviceClient = {
    auth: {
      admin: {
        getUserById: async (userId: string) => {
          if (!existingIds.has(userId)) {
            return {
              data: { user: null },
              error: { status: 404 }
            };
          }

          const actor = actors.find((candidate) => candidate.userId === userId)!;

          return {
            data: {
              user: {
                id: actor.userId,
                created_at: actor.createdAt,
                user_metadata: {
                  gate3_report_evidence_run_id: 'gate3-587a06c3fe49',
                  gate3_report_evidence_provisioning_nonce: attempt,
                  gate3_report_evidence_provisioning_attempt_id: attempt
                }
              }
            },
            error: null
          };
        },

        deleteUser: async (userId: string) => {
          deletedIds.push(userId);
          existingIds.delete(userId);
          return { data: {}, error: null };
        }
      }
    },

    from(table: string) {
      if (table === 'reports' || table === 'report_evidence_uploads') {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null })
          })
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },

    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null })
      })
    }
  };

  const result = await runnerModule.runAbandonedRecoveryCleanup({
    approval: 'ABANDONED_GATE3_RECOVERY_CLEANUP',
    manifestBytes,
    checkpoint,
    serviceClient,
    expectedRunId: 'gate3-587a06c3fe49',
    expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
  });

  expect(deletedIds).toEqual(actors.map((actor) => actor.userId));
  expect(result).toEqual({
    status: 'CLEANUP_VERIFIED',
    runId: 'gate3-587a06c3fe49',
    projectRef: 'nuhkpqjjyuygiemrxbdp',
    deletedActorCount: 4,
    counts: {
      accounts: 0,
      pending: 0,
      reports: 0,
      uploads: 0,
      objects: 0,
      queueRows: 0,
      foreignArtifacts: 0,
      preExistingAccounts: 0
    }
  });
});

  it('performs zero deletes when the approved cleanup checkpoint does not match the exact manifest', async () => {
    const runnerModule = await import(
      '../../scripts/hosted-abandoned-run-recovery-runner.mjs'
    );

    const attempt = '11111111-1111-4111-8111-111111111111';

    const manifest = {
      targetProjectRef: 'nuhkpqjjyuygiemrxbdp',
      runId: 'gate3-587a06c3fe49',
      provisioningAttemptId: attempt,
      credentialStoreId: '0'.repeat(64),
      pendingActors: [],
      actors: [
        {
          role: 'actor-one',
          userId: '11111111-1111-4111-8111-111111111112',
          createdAt: '2026-08-18T12:00:00.000Z',
          provisioningAttemptId: attempt
        },
        {
          role: 'actor-two',
          userId: '11111111-1111-4111-8111-111111111113',
          createdAt: '2026-08-18T12:00:01.000Z',
          provisioningAttemptId: attempt
        },
        {
          role: 'actor-three',
          userId: '11111111-1111-4111-8111-111111111114',
          createdAt: '2026-08-18T12:00:02.000Z',
          provisioningAttemptId: attempt
        },
        {
          role: 'actor-four',
          userId: '11111111-1111-4111-8111-111111111115',
          createdAt: '2026-08-18T12:00:03.000Z',
          provisioningAttemptId: attempt
        }
      ],
      reports: [],
      uploads: [],
      queueRows: []
    };

    const manifestBytes = new TextEncoder().encode(
      `${JSON.stringify(manifest)}\n`
    );

    let deleteCalls = 0;
    let authReadCalls = 0;

    const serviceClient = {
      auth: {
        admin: {
          getUserById: async () => {
            authReadCalls += 1;
            throw new Error('Auth must not be read before checkpoint validation');
          },
          deleteUser: async () => {
            deleteCalls += 1;
            return { data: {}, error: null };
          }
        }
      }
    };

    const wrongCheckpoint = {
      manifestSha256: '0'.repeat(64),
      runId: 'gate3-587a06c3fe49',
      projectRef: 'nuhkpqjjyuygiemrxbdp',
      phase: 'dry-run-verified',
      counts: {}
    };

    await expect(
      runnerModule.runAbandonedRecoveryCleanup({
        approval: 'ABANDONED_GATE3_RECOVERY_CLEANUP',
        manifestBytes,
        checkpoint: wrongCheckpoint,
        serviceClient,
        expectedRunId: 'gate3-587a06c3fe49',
        expectedProjectRef: 'nuhkpqjjyuygiemrxbdp'
      })
    ).rejects.toThrow(/checkpoint does not match the exact recovery manifest/u);

    expect(authReadCalls).toBe(0);
    expect(deleteCalls).toBe(0);
  });
