import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function migrateBoard() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS board_settings (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      public boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS board_profiles (
      id serial PRIMARY KEY,
      member_group text NOT NULL CHECK (member_group IN ('external', 'internal')),
      team_member_id integer UNIQUE REFERENCES team_members(id) ON DELETE CASCADE,
      slug text UNIQUE, name text, job_title text, short_description text,
      long_description text, image_url text, linkedin_url text, website text,
      email text, speaker_booking_url text,
      active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((member_group = 'internal' AND team_member_id IS NOT NULL AND name IS NULL AND slug IS NULL)
        OR (member_group = 'external' AND team_member_id IS NULL AND name IS NOT NULL AND slug IS NOT NULL))
    );
  `);
  // A single initialization statement: redeploys never reset visibility, edits,
  // removals or ordering. Exact verified identities, never "first Michelle".
  await db.execute(sql`
    WITH initialized AS (
      INSERT INTO board_settings (id, public) VALUES (1, false)
      ON CONFLICT (id) DO NOTHING RETURNING id
    )
    INSERT INTO board_profiles (member_group, team_member_id, sort_order)
    SELECT 'internal', t.id,
      CASE WHEN t.slug = 'michelle-caldwell' THEN 0 ELSE 1 END
    FROM team_members t, initialized
    WHERE (t.slug = 'michelle-caldwell' AND t.name = 'Michelle Caldwell')
       OR (t.slug = 'chris-mcnulty' AND t.name = 'Chris McNulty')
    ON CONFLICT (team_member_id) DO NOTHING;
  `);
}
