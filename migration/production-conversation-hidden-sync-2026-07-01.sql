-- Production schema sync for private conversation per-user hide flags.
-- This script is non-destructive: it only adds missing columns and normalizes nulls/defaults.

DO $$
BEGIN
  IF to_regclass('public.user_conversation') IS NULL THEN
    RAISE EXCEPTION 'Missing required table public.user_conversation';
  END IF;
END $$;

ALTER TABLE public.user_conversation
  ADD COLUMN IF NOT EXISTS user_a_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_b_hidden boolean NOT NULL DEFAULT false;

UPDATE public.user_conversation
SET user_a_hidden = false
WHERE user_a_hidden IS NULL;

UPDATE public.user_conversation
SET user_b_hidden = false
WHERE user_b_hidden IS NULL;

ALTER TABLE public.user_conversation
  ALTER COLUMN user_a_hidden SET DEFAULT false,
  ALTER COLUMN user_b_hidden SET DEFAULT false,
  ALTER COLUMN user_a_hidden SET NOT NULL,
  ALTER COLUMN user_b_hidden SET NOT NULL;
