import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://fois_user:fois_password@localhost:5432/fois_db";

const pool = new Pool({ connectionString: DATABASE_URL });

// --- Helper Utilities matching utils/mastersCrud.js ---
function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizeName(name) {
  return String(name || "").trim();
}

// --- STATE MASTER CRUD CONTROLLERS ---

export async function getAllStates(req, res) {
  try {
    const search = req.query.search?.trim() || "";
    if (search) {
      const searchPattern = `%${search}%`;
      const result = await pool.query(
        `SELECT id, code, name, active, created_at, updated_at 
         FROM state_master 
         WHERE name ILIKE $1 OR code ILIKE $1 
         ORDER BY name ASC`,
        [searchPattern]
      );
      return res.json(result.rows);
    }
    
    const result = await pool.query(
      `SELECT id, code, name, active, created_at, updated_at FROM state_master ORDER BY name ASC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error in getAllStates:", error);
    return res.status(500).json({ error: "Internal server error reading states" });
  }
}

export async function createState(req, res) {
  try {
    const { name, code } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: "Both state name and code are required" });
    }

    const normCode = normalizeCode(code);
    const normName = normalizeName(name);
    const id = `state_master_${normCode}`;

    // Conflict Check (Duplicate Name or Code)
    const existing = await pool.query(
      `SELECT id FROM state_master WHERE code = $1 OR UPPER(name) = UPPER($2)`,
      [normCode, normName]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "A state with this code or name already exists" });
    }

    const result = await pool.query(
      `INSERT INTO state_master (id, code, name, parent_code, active, created_at, updated_at)
       VALUES ($1, $2, $3, NULL, TRUE, NOW(), NOW())
       RETURNING *`,
      [id, normCode, normName]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error in createState:", error);
    return res.status(500).json({ error: "Internal server error creating state" });
  }
}

export async function updateState(req, res) {
  try {
    const { id } = req.params;
    const { name, code, active } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: "Both state name and code are required" });
    }

    const normCode = normalizeCode(code);
    const normName = normalizeName(name);

    // Conflict check excluding current record
    const existing = await pool.query(
      `SELECT id FROM state_master WHERE (code = $1 OR UPPER(name) = UPPER($2)) AND id <> $3`,
      [normCode, normName, id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Another state with this code or name already exists" });
    }

    const result = await pool.query(
      `UPDATE state_master 
       SET code = $1, name = $2, active = $3, updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [normCode, normName, active !== false, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "State not found" });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Error in updateState:", error);
    return res.status(500).json({ error: "Internal server error updating state" });
  }
}

export async function deleteState(req, res) {
  try {
    const { id } = req.params;
    
    // Check if any stations rely on this state before deleting
    const stateRecord = await pool.query(`SELECT code FROM state_master WHERE id = $1`, [id]);
    if (stateRecord.rows.length > 0) {
      const stateCode = stateRecord.rows[0].code;
      const dependency = await pool.query(`SELECT id FROM station_master WHERE UPPER(state) = $1 LIMIT 1`, [stateCode]);
      if (dependency.rows.length > 0) {
        return res.status(400).json({ error: "Cannot delete state. It is currently linked to active station masters." });
      }
    }

    const result = await pool.query(`DELETE FROM state_master WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "State not found" });
    }
    return res.json({ message: "State deleted successfully", id });
  } catch (error) {
    console.error("Error in deleteState:", error);
    return res.status(500).json({ error: "Internal server error deleting state" });
  }
}

// --- DISTRICT MASTER CRUD CONTROLLERS ---

export async function getAllDistricts(req, res) {
  try {
    const { state, search } = req.query;
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 500);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    let query = `SELECT id, code, name, parent_code, active, created_at, updated_at FROM district_master`;
    const params = [];
    const conditions = [];

    if (state) {
      params.push(normalizeCode(state));
      conditions.push(`parent_code = $${params.length}`);
    }

    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(" AND ");
    }
    const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM district_master${whereSql}`,
      params
    );
    params.push(limit, offset);
    query += ` ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return res.json({ items: result.rows, total: countResult.rows[0]?.total || 0 });
  } catch (error) {
    console.error("Error in getAllDistricts:", error);
    return res.status(500).json({ error: "Internal server error reading districts" });
  }
}

export async function createDistrict(req, res) {
  try {
    const { name, parent_code } = req.body; // parent_code is the State code
    if (!name || !parent_code) {
      return res.status(400).json({ error: "District name and parent state code are required" });
    }

    const normParent = normalizeCode(parent_code);
    const normName = normalizeName(name);
    const normCode = normalizeCode(`${normParent}_${name}`.replace(/\s+/g, "_"));
    const id = `district_master_${normParent}_${normCode}`;

    // Verify parent state exists
    const stateCheck = await pool.query(`SELECT id FROM state_master WHERE code = $1`, [normParent]);
    if (stateCheck.rows.length === 0) {
      return res.status(400).json({ error: `Parent state code '${normParent}' does not exist` });
    }

    // Check for duplicate district in the same state
    const duplicateCheck = await pool.query(
      `SELECT id FROM district_master WHERE parent_code = $1 AND UPPER(name) = UPPER($2)`,
      [normParent, normName]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ error: "This district already exists in the selected state" });
    }

    const result = await pool.query(
      `INSERT INTO district_master (id, code, name, parent_code, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
       RETURNING *`,
      [id, normCode, normName, normParent]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error in createDistrict:", error);
    return res.status(500).json({ error: "Internal server error creating district" });
  }
}

export async function updateDistrict(req, res) {
  try {
    const { id } = req.params;
    const { name, parent_code, active } = req.body;

    if (!name || !parent_code) {
      return res.status(400).json({ error: "District name and parent state code are required" });
    }

    const normParent = normalizeCode(parent_code);
    const normName = normalizeName(name);

    // Verify parent state exists
    const stateCheck = await pool.query(`SELECT id FROM state_master WHERE code = $1`, [normParent]);
    if (stateCheck.rows.length === 0) {
      return res.status(400).json({ error: `Parent state code '${normParent}' does not exist` });
    }

    // Check for duplicate district in same state excluding current id
    const duplicateCheck = await pool.query(
      `SELECT id FROM district_master WHERE parent_code = $1 AND UPPER(name) = UPPER($2) AND id <> $3`,
      [normParent, normName, id]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ error: "Another district with this name already exists in the selected state" });
    }

    const result = await pool.query(
      `UPDATE district_master 
       SET name = $1, parent_code = $2, active = $3, updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [normName, normParent, active !== false, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "District not found" });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Error in updateDistrict:", error);
    return res.status(500).json({ error: "Internal server error updating district" });
  }
}

export async function deleteDistrict(req, res) {
  try {
    const { id } = req.params;

    // Check if any stations rely on this district before deleting
    const districtRecord = await pool.query(`SELECT name FROM district_master WHERE id = $1`, [id]);
    if (districtRecord.rows.length > 0) {
      const distName = districtRecord.rows[0].name;
      const dependency = await pool.query(`SELECT id FROM station_master WHERE UPPER(district) = UPPER($1) LIMIT 1`, [distName]);
      if (dependency.rows.length > 0) {
        return res.status(400).json({ error: "Cannot delete district. It is currently linked to active station masters." });
      }
    }

    const result = await pool.query(`DELETE FROM district_master WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "District not found" });
    }
    return res.json({ message: "District deleted successfully", id });
  } catch (error) {
    console.error("Error in deleteDistrict:", error);
    return res.status(500).json({ error: "Internal server error deleting district" });
  }
}

export async function deleteAllDistricts(_req, res) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dependency = await client.query(
      `SELECT d.code, d.name
       FROM district_master d
       WHERE EXISTS (
         SELECT 1 FROM station_master s
         WHERE UPPER(s.district) = UPPER(d.code)
            OR UPPER(s.district) = UPPER(d.name)
       )
       ORDER BY d.name ASC
       LIMIT 10`
    );
    if (dependency.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Cannot delete all districts because some are linked to Station Master.",
        linked_districts: dependency.rows,
      });
    }

    const result = await client.query("DELETE FROM district_master RETURNING id");
    await client.query("COMMIT");
    return res.json({ message: "All districts deleted successfully", deleted_count: result.rowCount });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Error in deleteAllDistricts:", error);
    return res.status(500).json({ error: "Internal server error deleting all districts" });
  } finally {
    client.release();
  }
}
