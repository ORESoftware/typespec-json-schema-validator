# Release process

A release is eligible only when the candidate `main` revision has both:

1. an independent clean-clone verification covering install, syntax, CLI audit, unit tests, real-emitter integration tests, the full repository check, and a zero-finding example receipt; and
2. a successful hosted GitHub Actions workflow on the exact same commit.

Before publishing a package, inspect `npm pack --dry-run`, choose and document the registry access policy, publish with provenance, record the tag and tarball digests, and verify installation from a clean consumer fixture. A GitHub source release alone does not imply that an npm or GitHub Packages artifact was published.
