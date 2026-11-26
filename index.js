const express = require('express');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());

// ================= 👇 已填好你的配置 👇 =================
const BOT_TOKEN = '9267340308:AAF-HyhX0Fa_UnvLFmpPbzO22jRmcJGTMH4';
const ADMIN_IDS = new Set([8522211759]);
// ======================================================

const db = new Database('data.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, first_name TEXT, points INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, first_name TEXT,
    tier_id TEXT, tier_name TEXT, reward_points INTEGER, order_note TEXT,
    claim_month TEXT, status TEXT DEFAULT 'pending'
  );
`);

const REWARD_TIERS = [
  { id: 'u50',    name: '👑 50u 档位',    reward: 38,  only15th: true,  note: '只能15号一次' },
  { id: 'u200',   name: '👑 200u 档位',   reward: 58,  only15th: true,  note: '只能15号一次' },
  { id: 'u500',   name: '👑 500u 档位',   reward: 88,  only15th: false, note: '15号/30号发放' },
  { id: 'u1500',  name: '👑 1500u 档位',  reward: 158, only15th: false, note: '15号/30号发放' },
  { id: 'u3000',  name: '👑 3000u 档位',  reward: 238, only15th: false, note: '15号/30号发放' },
  { id: 'u6000',  name: '👑 6000u 档位',  reward: 358, only15th: false, note: '15号/30号发放' },
  { id: 'u10000', name: '👑 10000u 档位', reward: 558, only15th: false, note: '15号/30号发放' }
];

function getBeijingDateInfo() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return {
    day: now.getUTCDate(),
    yearMonth: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  };
}

function verifyTG(initData) {
  if (!initData) return null;
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get('hash');
    p.delete('hash');
    const str = Array.from(p.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const key = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    if (crypto.createHmac('sha256', key).update(str).digest('hex') !== hash) return null;
    return JSON.parse(p.get('user'));
  } catch (e) { return null; }
}

app.post('/api/user', (req, res) => {
  const user = verifyTG(req.body.initData);
  if (!user) return res.status(403).json({ success: false, message: '请在 Telegram 机器人内打开' });

  let row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(user.id);
  if (!row) {
    db.prepare('INSERT INTO users (user_id, first_name, points) VALUES (?, ?, 0)').run(user.id, user.first_name || '用户');
    row = { points: 0 };
  }
  const claims = db.prepare('SELECT * FROM claims WHERE user_id = ? ORDER BY id DESC LIMIT 15').all(user.id);
  res.json({ success: true, userId: user.id, points: row.points, isAdmin: ADMIN_IDS.has(user.id), tiers: REWARD_TIERS, claims });
});

app.post('/api/claim', (req, res) => {
  const { initData, tierId, orderNote } = req.body;
  const user = verifyTG(initData);
  if (!user) return res.status(403).json({ success: false, message: '身份验证失败' });

  const tier = REWARD_TIERS.find(t => t.id === tierId);
  if (!tier || !orderNote?.trim()) return res.json({ success: false, message: '请选择档位并填写充值凭证' });

  const { day, yearMonth } = getBeijingDateInfo();
  if (tier.only15th) {
    if (day !== 15) return res.json({ success: false, message: `【${tier.name}】仅限每月 15 号开放领取（今天是 ${day} 号）` });
    const exist = db.prepare("SELECT id FROM claims WHERE user_id = ? AND tier_id = ? AND claim_month = ? AND status != 'rejected'").get(user.id, tier.id, yearMonth);
    if (exist) return res.json({ success: false, message: '本月你已申请过该档位，每月仅限 15 号一次！' });
  }

  db.prepare('INSERT INTO claims (user_id, first_name, tier_id, tier_name, reward_points, order_note, claim_month) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, user.first_name || '用户', tier.id, tier.name, tier.reward, orderNote.trim(), yearMonth);
  res.json({ success: true, message: `✅ 申请已提交！将于每月 15 号/30 号统一发放 ${tier.reward}c` });
});

app.post('/api/admin/pending', (req, res) => {
  const admin = verifyTG(req.body.initData);
  if (!admin || !ADMIN_IDS.has(admin.id)) return res.status(403).json({ success: false });
  res.json({ success: true, list: db.prepare("SELECT * FROM claims WHERE status = 'pending' ORDER BY id ASC").all() });
});

app.post('/api/admin/review', (req, res) => {
  const { initData, claimId, action } = req.body;
  const admin = verifyTG(initData);
  if (!admin || !ADMIN_IDS.has(admin.id)) return res.status(403).json({ success: false, message: '无权操作' });

  const claim = db.prepare("SELECT * FROM claims WHERE id = ? AND status = 'pending'").get(claimId);
  if (!claim) return res.json({ success: false, message: '该申请已处理' });

  if (action === 'approve') {
    db.prepare("UPDATE claims SET status = 'approved' WHERE id = ?").run(claimId);
    const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(claim.user_id);
    if (!u) db.prepare('INSERT INTO users (user_id, first_name, points) VALUES (?, ?, ?)').run(claim.user_id, claim.first_name, claim.reward_points);
    else db.prepare('UPDATE users SET points = points + ? WHERE user_id = ?').run(claim.reward_points, claim.user_id);
    res.json({ success: true, message: `✅ 已通过！发放 ${claim.reward_points}c` });
  } else {
    db.prepare("UPDATE claims SET status = 'rejected' WHERE id = ?").run(claimId);
    res.json({ success: true, message: '已拒绝' });
  }
});

app.post('/api/admin/add-points', (req, res) => {
  const { initData, targetUserId, amount } = req.body;
  const admin = verifyTG(initData);
  if (!admin || !ADMIN_IDS.has(admin.id)) return res.status(403).json({ success: false, message: '无权操作' });
  const tid = Number(targetUserId), add = Number(amount);
  if (!tid || isNaN(add)) return res.json({ success: false, message: '格式错误' });

  const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(tid);
  if (!u) db.prepare('INSERT INTO users (user_id, first_name, points) VALUES (?, ?, ?)').run(tid, '用户', add);
  else db.prepare('UPDATE users SET points = points + ? WHERE user_id = ?').run(add, tid);
  const updated = db.prepare('SELECT points FROM users WHERE user_id = ?').get(tid);
  res.json({ success: true, newPoints: updated.points });
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>🌐 每个月活跃充值</title>
  <script src="https://telegram.org"></script>
  <style>
    body { font-family: -apple-system, sans-serif; background: var(--tg-theme-bg-color, #f2f4f7); color: var(--tg-theme-text-color, #111); margin: 0; padding: 16px; display: flex; flex-direction: column; align-items: center; }
    .card { background: var(--tg-theme-secondary-bg-color, #fff); border-radius: 16px; padding: 18px; width: 100%; max-width: 400px; box-sizing: border-box; margin-bottom: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .points-num { font-size: 42px; font-weight: 800; color: var(--tg-theme-button-color, #2481cc); margin: 6px 0; text-align: center; }
    .notice { background: rgba(36,129,204,0.1); border-left: 4px solid #2481cc; padding: 10px 12px; border-radius: 8px; font-size: 13px; line-height: 1.6; margin-bottom: 14px; }
    .tier-item { display: flex; justify-content: space-between; align-items: center; padding: 11px 14px; border-radius: 10px; border: 1.5px solid rgba(128,128,128,0.2); margin-bottom: 8px; cursor: pointer; }
    .tier-item.active { border-color: #2481cc; background: rgba(36,129,204,0.08); }
    .tag { font-size: 11px; color: #d97706; background: #fef3c7; padding: 2px 6px; border-radius: 4px; margin-left: 6px; }
    .tag.normal { color: #2563eb; background: #dbeafe; }
    input { width: 100%; padding: 11px; margin: 8px 0 14px; border: 1px solid rgba(128,128,128,0.3); border-radius: 10px; box-sizing: border-box; font-size: 14px; background: var(--tg-theme-bg-color, #fff); color: var(--tg-theme-text-color, #000); }
    button { background: var(--tg-theme-button-color, #2481cc); color: var(--tg-theme-button-text-color, #fff); border: none; border-radius: 10px; padding: 12px; font-size: 15px; font-weight: bold; width: 100%; cursor: pointer; }
    .record { font-size: 13px; padding: 9px 0; border-bottom: 1px dashed rgba(128,128,128,0.2); display: flex; justify-content: space-between; align-items: center; }
    .badge { padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; }
    .pending { background: #fff3cd; color: #856404; } .approved { background: #d4edda; color: #155724; } .rejected { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <div class="card" style="text-align:center;">
    <div id="userName" style="font-weight:bold;">连接中...</div>
    <div class="points-num"><span id="pointsDisplay">--</span><span style="font-size:18px;">c</span></div>
    <div id="userIdDisplay" style="font-size:12px;opacity:0.7;">ID: --</div>
  </div>
  <div class="card">
    <h3 style="margin:0 0 12px;">🌐 每个月活跃充值</h3>
    <div class="notice">📅 <b>每月 15号、30号 发放</b><br>⚠️ 50u、200u 档位<b>只能每月 15 号领取一次</b></div>
    <div id="tierList"></div>
    <input type="text" id="orderNoteInput" placeholder="填写充值账号 / 交易单号 / 凭证">
    <button id="submitBtn" onclick="submitClaim()">提交领取申请</button>
  </div>
  <div class="card">
    <h3 style="margin:0 0 10px;">📜 我的申请记录</h3>
    <div id="myClaimsList" style="font-size:13px;opacity:0.6;">暂无记录</div>
  </div>
  <div class="card" id="adminPanel" style="display:none; border:1.5px solid #2481cc;">
    <h3 style="margin:0 0 10px;">🛡️ 管理员审核台</h3>
    <div id="pendingList" style="margin-bottom:16px;">暂无待审核</div>
    <h3 style="margin:0 0 8px;">🛠️ 手动增减 c 币</h3>
    <input type="number" id="targetIdInput" placeholder="目标用户 ID">
    <input type="number" id="amountInput" placeholder="数量（负数扣除）">
    <button onclick="manualAdd()">确认调整</button>
  </div>
  <script>
