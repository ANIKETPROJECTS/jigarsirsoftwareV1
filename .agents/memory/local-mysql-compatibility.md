---
name: Local MySQL compatibility
description: Non-obvious constraints for running the imported Windows/MySQL database backups in this Linux workspace.
---

Retain the project's MySQL multi-database design. The local MariaDB service is a development-only compatibility choice, not a production database migration.

**Why:** The user requested running the imported application and restoring its included backups, not redesigning its storage or replacing existing users.

**How to apply:** Preserve original backup archives, existing password hashes, and group/company relationships. Never reset accounts merely to obtain test access.

Windows-origin dumps use lowercase table identifiers while application queries use mixed case. A Linux database must preserve case-insensitive lookup. MySQL 8 collations are not all available in MariaDB; adapt only the import stream. Cross-database views must be restored after every company's tables, and original view definers may refer to absent server accounts.

**Why:** Restoring databases independently can leave apparently healthy tables with broken report views, and successful authentication does not prove those views work.

**How to apply:** Check database view validity after restoration, not just table counts. Keep case behavior consistent before creating tables.

Disable InnoDB native asynchronous I/O in this development environment.

**Why:** The default initialization hit an unsupported sandbox syscall during setup.

**How to apply:** Retain this compatibility flag in both system-table initialization and the database server startup command.
