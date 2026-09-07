# IntervieHire V2

IntervieHire V2 is the isolated Bun/TypeScript migration lane: a Next.js recruiter
workspace, Elysia Core and Interview services, PostgreSQL-owned domain stores,
transactional outboxes, and a BullMQ worker topology. The legacy product remains intact
beside this directory and secondary capabilities stay reachable through `/compat/*`.

Start the complete deterministic stack with `bun run demo`; verify the golden product
path with `bun run test:e2e`. See [docs/DEMO.md](docs/DEMO.md),
[docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md), and
[docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md) for operation, boundaries, and migration
evidence.
