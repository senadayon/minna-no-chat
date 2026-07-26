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

// ミュートされたユーザーを記録するセット (Socket ID で管理)
const mutedUsers = new Set();

// ログイン・新規登録用のAPI
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (users[username]) return res.json({ success: false, message: '既に存在するユーザー名です' });
    users[username] = { password, role: 'user' };
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password, isAdminRequested, adminPassword } = req.body;
    const user = users[username];
    
    if (!user || user.password !== password) {
        return res.json({ success: false, message: 'ユーザー名またはパスワードが違います' });
    }

    let currentRole = user.role;

    if (isAdminRequested) {
        if (adminPassword === "dayo003") {
            currentRole = 'super_admin';
        } else if (adminPassword === "003kok25") {
            currentRole = 'admin';
        } else {
            return res.json({ success: false, message: '管理者用パスワードが間違っています' });
        }
    }

    res.json({ success: true, role: currentRole });
});

// 通信（Socket.io）の処理
io.on('connection', (socket) => {
    const userIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    if (ipBanList.has(userIp)) {
        socket.emit('system_message', 'あなたのアドレスは特権管理者によりアクセス禁止(IP BAN)されています。');
        socket.disconnect();
        return;
    }

    let currentUser = null;

    socket.on('join', ({ username, role }) => {
        currentUser = { username, role, ip: userIp, id: socket.id };
        socket.username = username;
        io.emit('system_message', `${username}さんが参加しました。(${role})`);
    });

    socket.on('chat_message', (msg) => {
        if (!currentUser) return;

        if (mutedUsers.has(socket.id)) {
            socket.emit('system_message', 'あなたは現在ミュートされているため発言できません。');
            return;
        }

        const text = msg.trim();

        if (text.startsWith('/')) {
            const parts = text.split(' ');
            const command = parts[0]; 
            const targetName = parts[1]; 
            const option = parts[2]; 

            const isAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin';
            const isSuperAdmin = currentUser.role === 'super_admin';

            // 1. 管理者・特権管理者 共通コマンド
            if (isAdmin) {
                switch (command) {
                    case '/delete':
                        io.emit('clear_messages');
                        io.emit('system_message', `管理者 ${currentUser.username} により、全メッセージが削除されました。`);
                        return;

                    case '/mute':
                        if (!targetName) return socket.emit('system_message', '使用例: /mute ユーザー名 秒数');
                        const muteSocket = [...io.sockets.sockets.values()].find(s => s.username === targetName);
                        if (muteSocket) {
                            mutedUsers.add(muteSocket.id);
                            const seconds = parseInt(option) || 60;
                            io.emit('system_message', `${targetName} さんが ${seconds} 秒間ミュートされました。`);
                            setTimeout(() => {
                                if (mutedUsers.has(muteSocket.id)) {
                                    mutedUsers.delete(muteSocket.id);
                                    muteSocket.emit('system_message', 'ミュートが解除されました。');
                                }
                            }, seconds * 1000);
                        } else {
                            socket.emit('system_message', `ユーザー ${targetName} が見つかりません。`);
                        }
                        return;

                    case '/unmute':
                        if (!targetName) return socket.emit('system_message', '使用例: /unmute ユーザー名');
                        const unmuteSocket = [...io.sockets.sockets.values()].find(s => s.username === targetName);
                        if (unmuteSocket && mutedUsers.has(unmuteSocket.id)) {
                            mutedUsers.delete(unmuteSocket.id);
                            io.emit('system_message', `${targetName} のミュートが解除されました。`);
                        } else {
                            socket.emit('system_message', `対象のユーザーが見つからないか、ミュートされていません。`);
                        }
                        return;

                    case '/ban':
                        if (!targetName) return socket.emit('system_message', '使用例: /ban ユーザー名');
                        const banSocket = [...io.sockets.sockets.values()].find(s => s.username === targetName);
                        if (banSocket) {
                            banSocket.emit('system_message', '管理者によりチャットから追放されました。');
                            banSocket.disconnect();
                            io.emit('system_message', `${targetName} さんがチャットから追放されました。`);
                        } else {
                            socket.emit('system_message', `ユーザー ${targetName} が見つかりません。`);
                        }
                        return;
                }
            }

            // 2. 特権管理者 専用コマンド
            if (isSuperAdmin) {
                switch (command) {
                    case '/rename': // ★最高管理者専用の名前強制変更
                        if (!targetName || !option) return socket.emit('system_message', '使用例: /rename 旧名 新名');
                        const renameSocket = [...io.sockets.sockets.values()].find(s => s.username === targetName);
                        if (renameSocket) {
                            const oldName = renameSocket.username;
                            const newName = option;
                            renameSocket.username = newName;
                            renameSocket.emit('force_rename', newName); // 本人に通知
                            io.emit('system_message', `特権管理者により、${oldName} さんの名前が ${newName} に変更されました。`);
                        } else {
                            socket.emit('system_message', `ユーザー ${targetName} が見つかりません。`);
                        }
                        return;

                    case '/ipban':
                        if (!targetName) return socket.emit('system_message', '使用例: /ipban ユーザー名');
                        const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === targetName);
                        if (targetSocket) {
                            const targetIp = targetSocket.handshake.headers['x-forwarded-for'] || targetSocket.handshake.address;
                            ipBanList.add(targetIp);
                            targetSocket.emit('system_message', 'あなたのアドレスは特権管理者によりアクセス禁止(IP BAN)されています。');
                            targetSocket.disconnect();
                            io.emit('system_message', `${targetName} さんが IP BAN されました。`);
                        } else {
                            ipBanList.add(targetName);
                            socket.emit('system_message', `IPアドレス ${targetName} を BAN リストに追加しました。`);
                        }
                        return;

                    case '/ipunban':
                        if (!targetName) return socket.emit('system_message', '使用例: /ipunban IPアドレス');
                        if (ipBanList.has(targetName)) {
                            ipBanList.delete(targetName);
                            socket.emit('system_message', `IPアドレス ${targetName} の BAN を解除しました。`);
                        } else {
                            socket.emit('system_message', '指定されたIPは BAN リストにありません。');
                        }
                        return;

                    case '/ipbanlist':
                        const list = [...ipBanList].join(', ') || 'なし';
                        socket.emit('system_message', `【現在のIP BANリスト】: ${list}`);
                        return;
                }
            }

            socket.emit('system_message', 'エラー: このコマンドを実行する権限がないか、存在しないコマンドです。');
            return;
        }

        let displayUsername = currentUser.username;
        if (currentUser.role === 'super_admin') {
            displayUsername += ' [★特権管理者]';
        } else if (currentUser.role === 'admin') {
            displayUsername += ' [管理者]';
        }

        io.emit('chat_message', {
            username: displayUsername,
            message: msg,
            role: currentUser.role
        });
    });

    socket.on('disconnect', () => {
        if (currentUser) {
            io.emit('system_message', `${currentUser.username}さんが退室しました。`);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
