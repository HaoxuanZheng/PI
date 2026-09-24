-- Account purge execution: carries out a deletion request after its recovery window.
-- A purged account stays DELETION_PENDING with its request window intact, so the
-- existing users_deletion_window CHECK passes unchanged; deletion_purged_at only
-- records that execution happened. Canonical rows are never hard-deleted: objects
-- are soft-deleted with DELETE revisions (edges tombstoned, embeddings, files, and
-- publications invalidated by their triggers), while derived and identifying data
-- (embedding vectors, stored bytes, analytics events) is removed by the repository.
ALTER TABLE users ADD COLUMN deletion_purged_at timestamptz;
