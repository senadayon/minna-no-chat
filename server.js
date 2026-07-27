const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// データベースの代わり（メモリ保存）
const users = {}; 
const ipBanList = new Set(); // BANされたIPを保存する場所

// ★ 特権管理者になるためのシークレットパスワード
const SUPER_ADMIN_SECRET = "dayo003";

// ログイン・新規登録用のAPI
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    if (!username) return res.json({ success: false, message: 'ユーザー名を入力してください' });

    // スペースで区切ってシークレットコードが入力されているかチェック
    const parts = username.trim().split(' ');
    const actualUsername = parts[0];
    const secretCode = parts[1];

    if (users[actualUsername]) return res.json({ success: false, message: '既に存在するユーザー名です' });
    
    // パスワードが一致したら特権管理者、それ以外は一般ユーザー
    let role = 'user';
    if (secretCode === SUPER_ADMIN_SECRET) {
        role = 'super_admin';
    }

    users[actualUsername] = { password, role };
    
    // 画面側に確定したroleをしっかり返す
    res.json({ success: true, username: actualUsername, role: role });
});

app.post('/api/login', (req, res) => {
    const { username, password, isAdminRequested } = req.body;
    
    if (!username) return res.json({ success: false, message: 'ユーザー名を入力してください' });
    
    const actualUsername = username.trim().split(' ')[0];
    const user = users[actualUsername];
    
    if (!user || user.password !== password) {
        return res.json({ success: false, message: 'ユーザー名またはパスワードが違います' });
    }

    let currentRole = user.role;
    
    // 一般ユーザーだけど「管理者としてログイン」にチェックを入れた場合はデモ用adminにする
    if (isAdminRequested && currentRole === 'user') {
        currentRole = 'admin';
    }

    // 画面側に確定したroleをしっかり返す
    res.json({ success: true, username: actualUsername, role: currentRole });
});

// 通信（Socket.io）の処理
io.on('connection', (socket) => {
    const userIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    // IPがBANリストに入っていたら即切断
    if (ipBanList.has(userIp)) {
        socket.emit('system_message', 'あなたのアドレスは特権管理者によりアクセス禁止(IP BAN)されています。');
        socket.disconnect();
        return;
    }

    let currentUser = null;

    socket.on('join', ({ username, role }) => {
        currentUser = { username, role, ip: userIp, id: socket.id };
        if (users[username]) {
            users[username].socketId = socket.id;
            users[username].ip = userIp;
        }
        io.emit('system_message', `${username}がチャットに参加しました`);
    });

    socket.on('chat_message', (msg) => {
        if (!currentUser) return;

        if (msg.startsWith('/')) {
            handleCommand(socket, currentUser, msg);
        } else {
            io.emit('message', { username: currentUser.username, text: msg });
        }
    });

    socket.on('disconnect', () => {
        if (currentUser) {
            io.emit('system_message', `${currentUser.username}がチャットから退出しました`);
        }
    });
});

// コマンドの判定と実行
function handleCommand(socket, user, msg) {
    const args = msg.split(' ');
    const command = args[0];

    // --- 【特権管理者専用コマンド】 ---
    if (command === '/ipban') {
        if (user.role !== 'super_admin') {
            socket.emit('system_message', '❌ エラー: 特権管理者のみ実行可能なコマンドです。');
            return;
        }

        const targetUser = args[1]; // ターゲットの指定
        if (!targetUser) {
            socket.emit('system_message', '⚠️ BANするユーザー名を指定してください。例: /ipban ユーザー名');
            return;
        }

        // ここにあなたの既存の targetSocket や IP特定、ipBanList.add のロジックが入ります

                if (targetSocket) {
            targetSocket.emit('system_message', 'あなたのアドレスは特権管理者によりアクセス禁止にされました。');
            targetSocket.disconnect();
        }
        return;
    }

    if (command === '/ipbanlist') {
        if (user.role !== 'super_admin') {
            socket.emit('system_message', '❌ エラー: 特権管理者のみ実行可能なコマンドです。');
            return;
        }
        const list = Array.from(ipBanList).join(', ') || '現在BANされているIPはありません。';
        socket.emit('system_message', `📋 【IP BAN リスト】: ${list}`);
        return;
    }

    if (command === '/ipunban') {
        if (user.role !== 'super_admin') {
            socket.emit('system_message', '❌ エラー: 特権管理者のみ実行可能なコマンドです。');
            return;
        }
        const targetIp = args[1];
        if (!targetIp) {
            socket.emit('system_message', '⚠️ 解除するIPアドレスを指定してください。例: /ipunban 127.0.0.1');
            return;
        }

        if (ipBanList.has(targetIp)) {
            ipBanList.delete(targetIp);
            socket.emit('system_message', `✅ IPアドレス [ ${targetIp} ] のBANを解除しました。`);
        } else {
            socket.emit('system_message', '⚠️ そのIPはBANリストに登録されていません。');
        }
        return;
    }

    // --- 【一般・通常の管理者コマンド】 ---
    if (command === '/delete') {
        if (user.role !== 'admin' && user.role !== 'super_admin') {
            socket.emit('system_message', '❌ エラー: 管理者以上の権限が必要です。');
            return;
        }
        io.emit('system_message', '🧹 管理者によってチャットログが全削除されました（画面を更新してください）。');
        return;
    }

    socket.emit('system_message', '⚠️ 知らないコマンド、またはまだ実装されていないコマンドです。');
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました`);
});
