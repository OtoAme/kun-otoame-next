-- Reviewed one-off merge for the seven production company duplicate groups
-- captured at 2026-08-31T06:52:10.98965Z.
-- Export SHA-256: d994bb0b7ec2c7ef40303be4c385e824db2376f5f289c249f80472e1a00b06e0.
--
-- Default mode performs every mutation and postcondition inside a transaction,
-- then rolls it back. Pass `--set APPLY=1` to commit the exact same transaction.

\set ON_ERROR_STOP on

\echo 'Reviewed company merge: validating the frozen production snapshot'

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE public.patch_company_relation IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.patch_company IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.patch_company_external_id IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.patch_company_name_identity IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE reviewed_company_merge (
  target_company_id integer PRIMARY KEY,
  source_company_id integer UNIQUE NOT NULL,
  introduction_from_company_id integer NOT NULL
) ON COMMIT DROP;

INSERT INTO reviewed_company_merge (
  target_company_id,
  source_company_id,
  introduction_from_company_id
)
VALUES
  (249, 324, 324),
  (28, 378, 28),
  (325, 400, 325),
  (300, 301, 300),
  (397, 395, 397),
  (88, 321, 88),
  (238, 417, 238);

CREATE TEMP TABLE reviewed_company_snapshot (
  company_id integer PRIMARY KEY,
  company_name text NOT NULL,
  normalized_name text NOT NULL,
  expected_count integer NOT NULL,
  expected_updated timestamp without time zone NOT NULL
) ON COMMIT DROP;

INSERT INTO reviewed_company_snapshot (
  company_id,
  company_name,
  normalized_name,
  expected_count,
  expected_updated
)
VALUES
  (28, 'Magic House', 'magic house', 3, TIMESTAMP '2026-08-31 03:30:30.408'),
  (88, 'Kogado Studio', 'kogado studio', 4, TIMESTAMP '2026-08-31 03:30:31.463'),
  (238, 'Design Factory', 'design factory', 4, TIMESTAMP '2026-08-31 03:30:33.737'),
  (249, '株式会社角川書店', '株式会社角川書店', 1, TIMESTAMP '2026-08-31 03:30:33.934'),
  (300, 'Uzumeya Honpo', 'uzumeya honpo', 1, TIMESTAMP '2026-08-31 03:30:34.665'),
  (301, 'Uzumeya', 'uzumeya', 1, TIMESTAMP '2026-08-31 03:30:34.682'),
  (321, 'KOGADO STUDIO', 'kogado studio', 2, TIMESTAMP '2026-08-31 03:30:34.998'),
  (324, 'Kadokawa Shoten', 'kadokawa shoten', 1, TIMESTAMP '2026-08-31 03:30:35.066'),
  (325, 'Extend', 'extend', 3, TIMESTAMP '2026-08-31 03:30:35.082'),
  (378, 'MagicHouse', 'magichouse', 1, TIMESTAMP '2026-08-31 03:30:35.869'),
  (395, 'Team D.T.R.', 'team d.t.r.', 1, TIMESTAMP '2026-08-31 03:30:36.117'),
  (397, 'Team D.T.R. ', 'team d.t.r.', 1, TIMESTAMP '2026-08-31 03:30:36.136'),
  (400, 'NIPPON CULTURAL BROADCASTING EXTEND INC.', 'nippon cultural broadcasting extend inc.', 2, TIMESTAMP '2026-08-31 03:30:36.168'),
  (417, 'design factory', 'design factory', 1, TIMESTAMP '2026-08-31 03:30:36.470');

CREATE TEMP TABLE reviewed_company_relation_snapshot (
  company_id integer NOT NULL,
  patch_id integer NOT NULL,
  PRIMARY KEY (company_id, patch_id)
) ON COMMIT DROP;

INSERT INTO reviewed_company_relation_snapshot (company_id, patch_id)
VALUES
  (28, 54),
  (28, 426),
  (28, 793),
  (88, 208),
  (88, 215),
  (88, 704),
  (88, 705),
  (238, 568),
  (238, 806),
  (238, 818),
  (238, 821),
  (249, 586),
  (300, 678),
  (301, 678),
  (321, 704),
  (321, 705),
  (324, 712),
  (325, 713),
  (325, 808),
  (325, 809),
  (378, 793),
  (395, 807),
  (397, 807),
  (400, 808),
  (400, 809),
  (417, 822);

DO $precondition$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT COUNT(*)
  INTO mismatch_count
  FROM public.patch_company;
  IF mismatch_count <> 406 THEN
    RAISE EXCEPTION
      'reviewed company merge refused: expected 406 companies, found %',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM reviewed_company_snapshot expected
  LEFT JOIN public.patch_company actual ON actual.id = expected.company_id
  WHERE actual.id IS NULL
     OR actual.name IS DISTINCT FROM expected.company_name
     OR actual.normalized_name IS DISTINCT FROM expected.normalized_name
     OR actual.count IS DISTINCT FROM expected.expected_count
     OR actual.updated IS DISTINCT FROM expected.expected_updated;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'reviewed company merge refused: % company snapshot rows changed since export',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (
    (
      SELECT relation.company_id, relation.patch_id
      FROM public.patch_company_relation relation
      JOIN reviewed_company_snapshot expected
        ON expected.company_id = relation.company_id
      EXCEPT
      SELECT company_id, patch_id
      FROM reviewed_company_relation_snapshot
    )
    UNION ALL
    (
      SELECT company_id, patch_id
      FROM reviewed_company_relation_snapshot
      EXCEPT
      SELECT relation.company_id, relation.patch_id
      FROM public.patch_company_relation relation
      JOIN reviewed_company_snapshot expected
        ON expected.company_id = relation.company_id
    )
  ) differences;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'reviewed company merge refused: affected relation snapshot differs in % rows',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM public.patch_company_external_id external_id
  JOIN reviewed_company_snapshot expected
    ON expected.company_id = external_id.company_id;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'reviewed company merge refused: expected no external IDs on affected companies, found %',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM public.patch_company_name_identity identity
  JOIN reviewed_company_snapshot expected
    ON expected.company_id = identity.company_id;
  IF mismatch_count <> 24 THEN
    RAISE EXCEPTION
      'reviewed company merge refused: expected 24 identity rows, found %',
      mismatch_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM reviewed_company_snapshot expected
    WHERE (
      SELECT COUNT(*)
      FROM public.patch_company_name_identity identity
      WHERE identity.company_id = expected.company_id
        AND identity.kind = 'name'
        AND identity.normalized_value = expected.normalized_name
    ) <> 1
  ) THEN
    RAISE EXCEPTION
      'reviewed company merge refused: a company does not have exactly one matching name identity';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM pg_trigger trigger_row
  WHERE trigger_row.tgrelid = 'public.patch_company_relation'::regclass
    AND trigger_row.tgname IN (
      'patch_company_count_trg_ins',
      'patch_company_count_trg_del',
      'patch_company_count_trg_upd'
    )
    AND trigger_row.tgenabled = 'O'
    AND NOT trigger_row.tgisinternal;
  IF mismatch_count <> 3 THEN
    RAISE EXCEPTION
      'reviewed company merge refused: expected three enabled company count triggers, found %',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM reviewed_company_snapshot expected
  JOIN public.patch_company company ON company.id = expected.company_id
  WHERE company.count <> (
    SELECT COUNT(*)::integer
    FROM public.patch_company_relation relation
    WHERE relation.company_id = company.id
  );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'reviewed company merge refused: affected company counters already drifted in % rows',
      mismatch_count;
  END IF;
END
$precondition$;

\echo 'Reviewed company merge: snapshot accepted; simulating merge'

UPDATE public.patch_company AS target
SET introduction = introduction_source.introduction,
    primary_language = ARRAY(
      SELECT DISTINCT language_value
      FROM unnest(
        COALESCE(target.primary_language, ARRAY[]::text[])
        || COALESCE(source.primary_language, ARRAY[]::text[])
      ) AS language_values(language_value)
      WHERE btrim(language_value) <> ''
      ORDER BY language_value
    ),
    official_website = ARRAY(
      SELECT DISTINCT website_value
      FROM unnest(
        COALESCE(target.official_website, ARRAY[]::text[])
        || COALESCE(source.official_website, ARRAY[]::text[])
      ) AS website_values(website_value)
      WHERE btrim(website_value) <> ''
      ORDER BY website_value
    ),
    parent_brand = ARRAY(
      SELECT DISTINCT brand_value
      FROM unnest(
        COALESCE(target.parent_brand, ARRAY[]::text[])
        || COALESCE(source.parent_brand, ARRAY[]::text[])
      ) AS brand_values(brand_value)
      WHERE btrim(brand_value) <> ''
      ORDER BY brand_value
    ),
    alias = ARRAY(
      SELECT unique_alias.alias_value
      FROM (
        SELECT DISTINCT btrim(alias_value) AS alias_value
        FROM unnest(
          COALESCE(target.alias, ARRAY[]::text[])
          || COALESCE(source.alias, ARRAY[]::text[])
          || ARRAY[source.name]::text[]
        ) AS alias_values(alias_value)
        WHERE btrim(alias_value) <> ''
          AND lower(btrim(alias_value)) <> lower(btrim(target.name))
      ) unique_alias
      ORDER BY lower(unique_alias.alias_value), unique_alias.alias_value
    ),
    updated = CURRENT_TIMESTAMP
FROM reviewed_company_merge merge_row
JOIN public.patch_company source
  ON source.id = merge_row.source_company_id
JOIN public.patch_company introduction_source
  ON introduction_source.id = merge_row.introduction_from_company_id
WHERE target.id = merge_row.target_company_id;

INSERT INTO public.patch_company_name_identity AS current_identity (
  company_id,
  kind,
  origin,
  value,
  normalized_value,
  confirmed_by_user_id,
  created,
  updated
)
SELECT
  merge_row.target_company_id,
  CASE WHEN identity.kind = 'name' THEN 'alias' ELSE identity.kind END,
  identity.origin,
  identity.value,
  identity.normalized_value,
  identity.confirmed_by_user_id,
  identity.created,
  CURRENT_TIMESTAMP
FROM reviewed_company_merge merge_row
JOIN public.patch_company_name_identity identity
  ON identity.company_id = merge_row.source_company_id
ON CONFLICT (company_id, kind, normalized_value)
DO UPDATE
SET origin = EXCLUDED.origin,
    value = EXCLUDED.value,
    confirmed_by_user_id = EXCLUDED.confirmed_by_user_id,
    updated = CURRENT_TIMESTAMP
WHERE
  (
    CASE WHEN EXCLUDED.origin = 'authoritative' THEN 2 ELSE 0 END
    + CASE WHEN EXCLUDED.confirmed_by_user_id IS NOT NULL THEN 1 ELSE 0 END
  ) > (
    CASE
      WHEN current_identity.origin = 'authoritative' THEN 2
      ELSE 0
    END
    + CASE
      WHEN current_identity.confirmed_by_user_id IS NOT NULL THEN 1
      ELSE 0
    END
  );

INSERT INTO public.patch_company_name_identity (
  company_id,
  kind,
  origin,
  value,
  normalized_value,
  confirmed_by_user_id,
  created,
  updated
)
SELECT
  merge_row.target_company_id,
  'alias',
  'legacy',
  source.name,
  source.normalized_name,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM reviewed_company_merge merge_row
JOIN public.patch_company source
  ON source.id = merge_row.source_company_id
ON CONFLICT (company_id, kind, normalized_value)
DO NOTHING;

INSERT INTO public.patch_company_relation (
  patch_id,
  company_id,
  created,
  updated
)
SELECT
  source_relation.patch_id,
  merge_row.target_company_id,
  source_relation.created,
  source_relation.updated
FROM reviewed_company_merge merge_row
JOIN public.patch_company_relation source_relation
  ON source_relation.company_id = merge_row.source_company_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.patch_company_relation target_relation
  WHERE target_relation.company_id = merge_row.target_company_id
    AND target_relation.patch_id = source_relation.patch_id
);

DELETE FROM public.patch_company_relation source_relation
USING reviewed_company_merge merge_row
WHERE source_relation.company_id = merge_row.source_company_id;

CREATE TEMP TABLE removed_reviewed_company (
  company_id integer PRIMARY KEY
) ON COMMIT DROP;

WITH removed AS (
  DELETE FROM public.patch_company source
  USING reviewed_company_merge merge_row
  WHERE source.id = merge_row.source_company_id
  RETURNING source.id
)
INSERT INTO removed_reviewed_company (company_id)
SELECT id
FROM removed;

UPDATE public.patch_company target
SET name = btrim(target.name),
    updated = CURRENT_TIMESTAMP
FROM reviewed_company_merge merge_row
WHERE target.id = merge_row.target_company_id;

CREATE TEMP TABLE reviewed_expected_post_relation (
  company_id integer NOT NULL,
  patch_id integer NOT NULL,
  PRIMARY KEY (company_id, patch_id)
) ON COMMIT DROP;

INSERT INTO reviewed_expected_post_relation (company_id, patch_id)
SELECT DISTINCT
  COALESCE(merge_row.target_company_id, snapshot.company_id),
  snapshot.patch_id
FROM reviewed_company_relation_snapshot snapshot
LEFT JOIN reviewed_company_merge merge_row
  ON merge_row.source_company_id = snapshot.company_id;

DO $postcondition$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT COUNT(*)
  INTO mismatch_count
  FROM removed_reviewed_company;
  IF mismatch_count <> 7 THEN
    RAISE EXCEPTION
      'reviewed company merge failed: expected to remove 7 companies, removed %',
      mismatch_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM reviewed_company_merge merge_row
    JOIN public.patch_company source
      ON source.id = merge_row.source_company_id
  ) THEN
    RAISE EXCEPTION 'reviewed company merge failed: a source company remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM reviewed_company_merge merge_row
    LEFT JOIN public.patch_company target
      ON target.id = merge_row.target_company_id
    WHERE target.id IS NULL
  ) THEN
    RAISE EXCEPTION 'reviewed company merge failed: a target company is missing';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM public.patch_company;
  IF mismatch_count <> 399 THEN
    RAISE EXCEPTION
      'reviewed company merge failed: expected 399 companies, found %',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (
    (
      SELECT relation.company_id, relation.patch_id
      FROM public.patch_company_relation relation
      JOIN reviewed_company_merge merge_row
        ON merge_row.target_company_id = relation.company_id
      EXCEPT
      SELECT company_id, patch_id
      FROM reviewed_expected_post_relation
    )
    UNION ALL
    (
      SELECT company_id, patch_id
      FROM reviewed_expected_post_relation
      EXCEPT
      SELECT relation.company_id, relation.patch_id
      FROM public.patch_company_relation relation
      JOIN reviewed_company_merge merge_row
        ON merge_row.target_company_id = relation.company_id
    )
  ) differences;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'reviewed company merge failed: target relation post-state differs in % rows',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM public.patch_company company
  LEFT JOIN public.patch_company_relation relation
    ON relation.company_id = company.id
  GROUP BY company.id, company.count
  HAVING company.count <> COUNT(relation.id)::integer
  LIMIT 1;
  IF mismatch_count IS NOT NULL THEN
    RAISE EXCEPTION
      'reviewed company merge failed: patch_company.count invariant is not satisfied';
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM public.patch_company
  WHERE normalized_name IS NULL OR btrim(normalized_name) = '';
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'reviewed company merge failed: blank normalized names=%',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (
    SELECT normalized_name
    FROM public.patch_company
    GROUP BY normalized_name
    HAVING COUNT(*) > 1
  ) collisions;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'reviewed company merge failed: normalized name collision groups=%',
      mismatch_count;
  END IF;

  SELECT COUNT(*)
  INTO mismatch_count
  FROM (
    SELECT source, external_id
    FROM public.patch_company_external_id
    GROUP BY source, external_id
    HAVING COUNT(*) > 1
  ) collisions;
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'reviewed company merge failed: external identity collision groups=%',
      mismatch_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM reviewed_company_merge merge_row
    JOIN reviewed_company_snapshot source_snapshot
      ON source_snapshot.company_id = merge_row.source_company_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.patch_company_name_identity identity
      WHERE identity.company_id = merge_row.target_company_id
        AND identity.kind = 'alias'
        AND identity.normalized_value = source_snapshot.normalized_name
    )
  ) THEN
    RAISE EXCEPTION
      'reviewed company merge failed: a source name identity was not preserved as an alias';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM reviewed_company_merge merge_row
    JOIN public.patch_company target
      ON target.id = merge_row.target_company_id
    WHERE target.name <> btrim(target.name)
       OR target.primary_language IS NULL
       OR target.official_website IS NULL
       OR target.parent_brand IS NULL
       OR target.alias IS NULL
  ) THEN
    RAISE EXCEPTION
      'reviewed company merge failed: target text/array normalization failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patch_company
    WHERE id = 249 AND 'Kadokawa Shoten' = ANY(alias)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.patch_company
    WHERE id = 28 AND 'MagicHouse' = ANY(alias)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.patch_company
    WHERE id = 300 AND 'Uzumeya' = ANY(alias)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.patch_company
    WHERE id = 325
      AND 'NIPPON CULTURAL BROADCASTING EXTEND INC.' = ANY(alias)
  ) THEN
    RAISE EXCEPTION
      'reviewed company merge failed: a distinct source name is missing from target aliases';
  END IF;
END
$postcondition$;

SELECT
  'reviewed_target' AS check_type,
  company.id,
  company.name,
  company.normalized_name,
  company.count,
  company.alias,
  company.user_id
FROM public.patch_company company
JOIN reviewed_company_merge merge_row
  ON merge_row.target_company_id = company.id
ORDER BY company.id;

SELECT
  'reviewed_target_relation_count' AS check_type,
  relation.company_id,
  COUNT(*) AS relation_count
FROM public.patch_company_relation relation
JOIN reviewed_company_merge merge_row
  ON merge_row.target_company_id = relation.company_id
GROUP BY relation.company_id
ORDER BY relation.company_id;

\if :{?APPLY}
  \if :APPLY
    COMMIT;
    \echo 'Reviewed company merge committed (APPLY=1)'
  \else
    ROLLBACK;
    \echo 'Reviewed company merge dry-run complete; rolled back (APPLY is false)'
  \endif
\else
  ROLLBACK;
  \echo 'Reviewed company merge dry-run complete; rolled back (APPLY was not set)'
\endif
