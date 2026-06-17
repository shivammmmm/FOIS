const http = require('http');

// Read token from localStorage is impossible server-side, so we call without auth
// and also call the raw DB audit directly

// First: call the endpoint WITHOUT auth to see what error we get
const payload = JSON.stringify({
  entityType: 'movement',
  dateRange: { preset: '30' },
  filters: {},
  pagination: { limit: 500, offset: 0 }
});

function callApi(token) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/dashboard/freight/filter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${token}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('=== DASHBOARD API AUDIT ===');
  console.log('Payload sent:', payload);
  console.log('');

  // Try with a dummy token first
  const r1 = await callApi('dummy-token');
  console.log('HTTP Status:', r1.status);

  if (r1.status === 401 || r1.status === 403) {
    console.log('AUTH REQUIRED - endpoint needs valid JWT');
    console.log('Response:', r1.body.slice(0, 200));
    console.log('');
    console.log('Trying to get token from login...');

    // Try login to get a real token
    const loginPayload = JSON.stringify({ email: 'admin@fois.in', password: 'admin123' });
    const token = await new Promise((resolve) => {
      const opts = {
        hostname: 'localhost', port: 3001, path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginPayload) }
      };
      const req = http.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d).token || ''); } catch { resolve(''); }
        });
      });
      req.on('error', () => resolve(''));
      req.write(loginPayload);
      req.end();
    });

    if (token) {
      console.log('Got token, calling API...');
      const r2 = await callApi(token);
      console.log('HTTP Status with auth:', r2.status);
      analyzeResponse(r2.body);
    } else {
      console.log('Login failed, no token available');
    }
  } else {
    analyzeResponse(r1.body);
  }
}

function analyzeResponse(body) {
  try {
    const json = JSON.parse(body);
    const items = json.items || [];
    const inward = items.filter(x => x.movement_type === 'Inward');
    const outward = items.filter(x => x.movement_type === 'Outward');
    const other = items.filter(x => x.movement_type !== 'Inward' && x.movement_type !== 'Outward');

    console.log('');
    console.log('=== RAW RESPONSE ANALYSIS ===');
    console.log('Total rows returned:', items.length);
    console.log('count field in response:', json.count);
    console.log('Inward rows:', inward.length);
    console.log('Outward rows:', outward.length);
    console.log('Other movement_type rows:', other.length);
    console.log('');

    if (items.length > 0) {
      console.log('--- SAMPLE ROW (first 3) ---');
      items.slice(0, 3).forEach((x, i) => {
        console.log(`Row ${i+1}:`, JSON.stringify({
          id: x.id,
          movement_type: x.movement_type,
          created_date: x.created_date,
          arrival_date: x.arrival_date,
          departure_date: x.departure_date,
        }));
      });

      // Check movement_type distribution
      const typeMap = {};
      items.forEach(x => { typeMap[x.movement_type || 'NULL'] = (typeMap[x.movement_type || 'NULL'] || 0) + 1; });
      console.log('');
      console.log('--- movement_type distribution ---');
      console.log(JSON.stringify(typeMap, null, 2));

      // Check created_date distribution
      const dateMap = {};
      items.forEach(x => {
        const d = x.created_date ? x.created_date.slice(0, 10) : 'NULL';
        dateMap[d] = (dateMap[d] || 0) + 1;
      });
      console.log('');
      console.log('--- created_date distribution (by day) ---');
      Object.entries(dateMap).sort().forEach(([k, v]) => console.log(`  ${k}: ${v} rows`));
    } else {
      console.log('ZERO ROWS RETURNED - possible causes:');
      console.log('  1. No records in freight_movements with created_date in last 30 days');
      console.log('  2. Auth failure returned empty/error body');
      console.log('Raw body (first 500 chars):', body.slice(0, 500));
    }
  } catch (e) {
    console.log('Failed to parse JSON response:', e.message);
    console.log('Raw body:', body.slice(0, 500));
  }
}

main().catch(console.error);
