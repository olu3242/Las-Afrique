import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import {
  asAnon,
  asUser,
  createMigratedDatabase,
  createUser,
  dropDatabase,
} from "@/supabase/test/harness";

const DB = "tmh_test_vault";

/**
 * The vault's isolation, executed against the real policy predicates.
 *
 * These matter more than most: the objects are passport scans. A policy that
 * looks right and is not is the difference between a private document and a
 * public one.
 */
describe("vault storage", () => {
  let db: Client;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    db = await createMigratedDatabase(DB);
    alice = await createUser(db, "alice@vault.test");
    bob = await createUser(db, "bob@vault.test");
  });

  afterAll(async () => {
    await db?.end();
    await dropDatabase(DB);
  });

  it("creates a private bucket", async () => {
    // Public would make a passport scan reachable by URL alone.
    const { rows } = await db.query<{ public: boolean; file_size_limit: string }>(
      `select public, file_size_limit from storage.buckets where id = 'vault'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
    expect(Number(rows[0].file_size_limit)).toBe(15_728_640);
  });

  it("accepts only document mime types", async () => {
    const { rows } = await db.query<{ allowed_mime_types: string[] }>(
      `select allowed_mime_types from storage.buckets where id = 'vault'`,
    );
    expect(rows[0].allowed_mime_types).toContain("application/pdf");
    expect(rows[0].allowed_mime_types).toContain("image/jpeg");
    // No archives, no executables, nothing that is not a travel document.
    expect(rows[0].allowed_mime_types).not.toContain("application/zip");
  });

  it("covers all four verbs with a policy", async () => {
    const { rows } = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'vault_%'`,
    );
    expect(new Set(rows.map((r) => r.cmd))).toEqual(
      new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]),
    );
  });

  describe("ownership by path", () => {
    it("lets a user write into their own folder", async () => {
      await asUser(db, alice, async () => {
        await db.query(
          `insert into storage.objects (bucket_id, name, owner)
           values ('vault', $1, $2)`,
          [`${alice}/passport.pdf`, alice],
        );
      });
    });

    it("refuses a write into another user's folder", async () => {
      // The attack this is here for: Bob naming a path under Alice's id.
      await expect(
        asUser(db, bob, async () => {
          await db.query(
            `insert into storage.objects (bucket_id, name, owner)
             values ('vault', $1, $2)`,
            [`${alice}/stolen.pdf`, bob],
          );
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it("hides another user's objects from selects", async () => {
      await db.query(
        `insert into storage.objects (bucket_id, name, owner)
         values ('vault', $1, $2)`,
        [`${alice}/private.pdf`, alice],
      );

      const rows = await asUser(db, bob, async () => {
        const { rows } = await db.query(
          `select name from storage.objects where bucket_id = 'vault'`,
        );
        return rows;
      });
      expect(rows).toEqual([]);
    });

    it("refuses to move an object into another user's folder", async () => {
      // `with check` alongside `using`, so a rename cannot re-home a file.
      const { rows } = await db.query<{ id: string }>(
        `insert into storage.objects (bucket_id, name, owner)
         values ('vault', $1, $2) returning id`,
        [`${bob}/mine.pdf`, bob],
      );

      await expect(
        asUser(db, bob, async () => {
          await db.query(`update storage.objects set name = $1 where id = $2`, [
            `${alice}/mine.pdf`,
            rows[0].id,
          ]);
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it("matches nothing when deleting another user's object", async () => {
      await db.query(
        `insert into storage.objects (bucket_id, name, owner)
         values ('vault', $1, $2)`,
        [`${alice}/keep.pdf`, alice],
      );

      const deleted = await asUser(db, bob, async () => {
        const result = await db.query(
          `delete from storage.objects where name = $1`,
          [`${alice}/keep.pdf`],
        );
        return result.rowCount;
      });
      expect(deleted).toBe(0);
    });

    it("gives a signed-out visitor nothing at all", async () => {
      // Asserts the property, not the mechanism. Supabase grants anon SELECT
      // on storage.objects and lets RLS scope it, so denial lands as an empty
      // result rather than an error — and an empty result is the security
      // guarantee. Written this way it cannot pass while rows leak.
      const rows = await asAnon(db, async () => {
        const { rows } = await db.query(
          `select name from storage.objects where bucket_id = 'vault'`,
        );
        return rows;
      });
      expect(rows).toEqual([]);
    });
  });

  describe("metadata agrees with storage", () => {
    it("refuses a vault_files row pointing outside its owner's folder", async () => {
      // Without this a row could claim a path it has no rights to, and
      // reconciliation would report a file the user cannot actually reach.
      await expect(
        db.query(
          `insert into public.vault_files (user_id, storage_path, file_name)
           values ($1, $2, 'stolen.pdf')`,
          [bob, `${alice}/stolen.pdf`],
        ),
      ).rejects.toThrow(/path_under_owner/);
    });

    it("accepts a row whose path sits under its owner", async () => {
      await db.query(
        `insert into public.vault_files (user_id, storage_path, file_name)
         values ($1, $2, 'passport.pdf')`,
        [alice, `${alice}/trip/passport.pdf`],
      );
      const { rows } = await db.query(
        `select file_name from public.vault_files where user_id = $1`,
        [alice],
      );
      expect(rows).toHaveLength(1);
    });
  });

  it("resolves the owning folder the way Supabase does", async () => {
    // The policies compare (foldername(name))[1] to auth.uid(); a shim that
    // got this wrong would test the wrong predicate entirely.
    const { rows } = await db.query<{ first: string }>(
      `select (storage.foldername('uid-123/trip/passport.pdf'))[1] as first`,
    );
    expect(rows[0].first).toBe("uid-123");
  });
});
