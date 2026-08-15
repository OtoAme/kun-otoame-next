-- One-time production alignment for the Sticker schema introduced by the
-- 2026-08-14 private-chat/admin migrations.
--
-- The original manual sync created valid Sticker tables, but older copies of
-- that sync used PostgreSQL's default timestamp precision, database defaults
-- that are not present in Prisma, and ON UPDATE NO ACTION foreign keys. This
-- script aligns an already-migrated database with prisma/schema without
-- touching application data or the known patch_released_idx drift.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.sticker_pack') IS NULL
     OR to_regclass('public.sticker') IS NULL
     OR to_regclass('public.user_sticker_pack') IS NULL
     OR to_regclass('public.user_private_message') IS NULL THEN
    RAISE EXCEPTION 'Required Sticker tables are missing; run the Sticker base/admin sync first';
  END IF;
END $$;

ALTER TABLE public.sticker_pack
  ALTER COLUMN created TYPE timestamp(3) without time zone
    USING created::timestamp(3),
  ALTER COLUMN updated TYPE timestamp(3) without time zone
    USING updated::timestamp(3),
  ALTER COLUMN updated DROP DEFAULT;

ALTER TABLE public.sticker
  ALTER COLUMN asset_url DROP NOT NULL,
  ALTER COLUMN asset_url DROP DEFAULT,
  ALTER COLUMN storage_key DROP DEFAULT,
  ALTER COLUMN mime DROP DEFAULT,
  ALTER COLUMN media_type DROP DEFAULT,
  ALTER COLUMN width DROP DEFAULT,
  ALTER COLUMN height DROP DEFAULT,
  ALTER COLUMN size DROP DEFAULT,
  ALTER COLUMN created TYPE timestamp(3) without time zone
    USING created::timestamp(3),
  ALTER COLUMN updated TYPE timestamp(3) without time zone
    USING updated::timestamp(3),
  ALTER COLUMN updated DROP DEFAULT;

ALTER TABLE public.user_sticker_pack
  ALTER COLUMN acquired_at TYPE timestamp(3) without time zone
    USING acquired_at::timestamp(3),
  ALTER COLUMN created TYPE timestamp(3) without time zone
    USING created::timestamp(3),
  ALTER COLUMN updated TYPE timestamp(3) without time zone
    USING updated::timestamp(3),
  ALTER COLUMN updated DROP DEFAULT;

DO $$
DECLARE
  expected record;
  current_definition text;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      (
        'public.sticker'::regclass,
        'sticker_pack_id_fkey',
        'ON DELETE RESTRICT ON UPDATE CASCADE',
        'ALTER TABLE public.sticker ADD CONSTRAINT sticker_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.sticker_pack(id) ON DELETE RESTRICT ON UPDATE CASCADE'
      ),
      (
        'public.user_sticker_pack'::regclass,
        'user_sticker_pack_user_id_fkey',
        'ON DELETE CASCADE ON UPDATE CASCADE',
        'ALTER TABLE public.user_sticker_pack ADD CONSTRAINT user_sticker_pack_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE ON UPDATE CASCADE'
      ),
      (
        'public.user_sticker_pack'::regclass,
        'user_sticker_pack_pack_id_fkey',
        'ON DELETE CASCADE ON UPDATE CASCADE',
        'ALTER TABLE public.user_sticker_pack ADD CONSTRAINT user_sticker_pack_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.sticker_pack(id) ON DELETE CASCADE ON UPDATE CASCADE'
      ),
      (
        'public.user_private_message'::regclass,
        'user_private_message_sticker_id_fkey',
        'ON DELETE SET NULL ON UPDATE CASCADE',
        'ALTER TABLE public.user_private_message ADD CONSTRAINT user_private_message_sticker_id_fkey FOREIGN KEY (sticker_id) REFERENCES public.sticker(id) ON DELETE SET NULL ON UPDATE CASCADE'
      ),
      (
        'public.user_private_message'::regclass,
        'user_private_message_reply_sticker_id_fkey',
        'ON DELETE SET NULL ON UPDATE CASCADE',
        'ALTER TABLE public.user_private_message ADD CONSTRAINT user_private_message_reply_sticker_id_fkey FOREIGN KEY (reply_sticker_id) REFERENCES public.sticker(id) ON DELETE SET NULL ON UPDATE CASCADE'
      ),
      (
        'public.sticker_pack'::regclass,
        'sticker_pack_cover_sticker_id_fkey',
        'ON DELETE SET NULL ON UPDATE CASCADE',
        'ALTER TABLE public.sticker_pack ADD CONSTRAINT sticker_pack_cover_sticker_id_fkey FOREIGN KEY (cover_sticker_id) REFERENCES public.sticker(id) ON DELETE SET NULL ON UPDATE CASCADE'
      )
    ) AS constraints(table_oid, constraint_name, expected_actions, add_sql)
  LOOP
    SELECT pg_get_constraintdef(pg_constraint.oid)
    INTO current_definition
    FROM pg_constraint
    WHERE conrelid = expected.table_oid
      AND conname = expected.constraint_name;

    IF current_definition IS NOT NULL
       AND position(upper(expected.expected_actions) IN upper(current_definition)) = 0 THEN
      EXECUTE format(
        'ALTER TABLE %s DROP CONSTRAINT %I',
        expected.table_oid,
        expected.constraint_name
      );
      current_definition := NULL;
    END IF;

    IF current_definition IS NULL THEN
      EXECUTE expected.add_sql;
    END IF;
  END LOOP;
END $$;

COMMIT;
