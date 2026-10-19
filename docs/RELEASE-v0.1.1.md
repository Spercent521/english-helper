# English Helper v0.1.1

- Query both public dictionary sources concurrently for new words. The first
  valid result is saved; the slower request is cancelled.
- Correct an error where a network failure in one provider masked a valid
  not-found response from another provider.
- Keep existing SQLite data and the memory-only online pronunciation behavior.

Public endpoints can still be unavailable and some words are not covered.
This preview remains ad-hoc signed and is not notarized.
