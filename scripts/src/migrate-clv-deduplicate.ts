import { pool } from "@workspace/db";

async function deduplicateClvRecords() {
  const client = await pool.connect();
  try {
    console.log("Checking for duplicate clv_records rows...");

    const countRes = await client.query<{ duplicates: string }>(`
      SELECT (COUNT(*) - COUNT(DISTINCT entry_pick_id))::text AS duplicates
      FROM clv_records
    `);
    const duplicates = Number(countRes.rows[0]?.duplicates ?? 0);

    if (duplicates === 0) {
      console.log("No duplicate clv_records rows found — nothing to do.");
    } else {
      console.log(`Found ${duplicates} duplicate row(s). Removing extras (keeping most recent per entry_pick_id)...`);

      await client.query(`
        DELETE FROM clv_records
        WHERE id NOT IN (
          SELECT DISTINCT ON (entry_pick_id) id
          FROM clv_records
          ORDER BY entry_pick_id, created_at DESC NULLS LAST, id DESC
        )
      `);

      console.log(`Removed ${duplicates} duplicate clv_records row(s).`);
    }

    const verifyRes = await client.query<{ total: string; distinct: string }>(`
      SELECT COUNT(*)::text AS total, COUNT(DISTINCT entry_pick_id)::text AS distinct
      FROM clv_records
    `);
    const verify = verifyRes.rows[0];
    console.log(`Verification: ${verify?.total} total rows, ${verify?.distinct} distinct entry_pick_id values.`);

    if (verify?.total !== verify?.distinct) {
      console.error("ERROR: duplicates still exist after cleanup — investigate before creating unique index.");
      process.exit(1);
    }

    console.log("Done. Safe to apply unique index on clv_records.entry_pick_id.");
  } finally {
    client.release();
    await pool.end();
  }
}

deduplicateClvRecords()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
