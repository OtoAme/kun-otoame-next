-- Non-destructive schema sync for admin Sticker management.
-- Run after production-private-chat-stickers-sync-2026-08-14.sql.

DO $$
BEGIN
  IF to_regclass('public.sticker_pack') IS NULL
     OR to_regclass('public.sticker') IS NULL THEN
    RAISE EXCEPTION 'Missing required Sticker catalog tables';
  END IF;
END $$;

ALTER TABLE public.sticker_pack
  ADD COLUMN IF NOT EXISTS cover_storage_key varchar(500),
  ADD COLUMN IF NOT EXISTS cover_sticker_id varchar(100);

ALTER TABLE public.sticker
  ADD COLUMN IF NOT EXISTS status integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash char(64);

UPDATE public.sticker
SET status = 1
WHERE status IS NULL;

ALTER TABLE public.sticker
  ALTER COLUMN asset_url DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 1,
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sticker
    WHERE content_hash IS NOT NULL
    GROUP BY pack_id, content_hash
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate non-null sticker content_hash values exist';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sticker_pack_cover_sticker_id_idx
  ON public.sticker_pack (cover_sticker_id);
CREATE UNIQUE INDEX IF NOT EXISTS sticker_pack_id_content_hash_key
  ON public.sticker (pack_id, content_hash);
CREATE INDEX IF NOT EXISTS sticker_content_hash_idx
  ON public.sticker (content_hash);
CREATE INDEX IF NOT EXISTS sticker_pack_id_status_sort_order_idx
  ON public.sticker (pack_id, status, sort_order);

DO $$
BEGIN
  ALTER TABLE public.sticker_pack
    ADD CONSTRAINT sticker_pack_cover_sticker_id_fkey
    FOREIGN KEY (cover_sticker_id) REFERENCES public.sticker(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
