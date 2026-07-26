﻿const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// データベースの代わり（メモリ保存）
const users = {}; 
const ipBanList = new Set(); // BANされたIPを保存する場所

// ★ 特権管理者になるためのシークレットパスワード（英語と数字が安全です）
const SUPER_ADMIN_SECRET = "dayo003";

// ログイン・新規登録用のAPI
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
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
    res.json({ success: true });
});

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

// ミュートされたユーザーを記録するセット (Socket ID で管理)
const mutedUsers = new Set();

// ログイン・新規登録用のAPI
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    const parts = username.trim().split(' ');
    const actualUsername = parts[0];
    const secretCode = parts[1];

    if (users[actualUsername]) return res.json({ success: false, message: '既に存在するユーザー名です' });
    
    let role = 'user';
    if (secretCode === SUPER_ADMIN_SECRET) {
        role = 'super_admin';
    }

    users[actualUsername] = { password, role };
    res.json({ success: true, actualUsername });
});

app.post('/api/login', (req, res) => {
    const { username, password, isAdminRequested, adminPassword } = req.body;
    const user = users[username];
    
    if (!user || user.password !== password) {
        return res.json({ success: false, message: 'ユーザー名またはパスワードが違います' });
    }

    let currentRole = user.role;

    // 「管理者としてログイン」にチェックが入っている場合
    if (isAdminRequested) {
        if (adminPassword === "003kok25") {
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

    // IPがBANリストに入っていたら即切断
    if (ipBanList.has(userIp)) {
        socket.emit('system_message', 'あなたのアドレスは特権管理者によりアクセス禁止(IP BAN)されています。');
        socket.disconnect();
        return;
    }

    let currentUser = null;

    // ユーザーが参加したとき
    socket.on('join', ({ username, role }) => {
        currentUser = { username, role, ip: userIp, id: socket.id };
        socket.username = username; // コマンド検索用にソケットに名前を記録
        
        io.emit('system_message', `${username}さんが参加しました。(${role})`);
    });

    // メッセージ受信＆コマンド処理
    socket.on('chat_message', (msg) => {
        if (!currentUser) return;

        // ミュートチェック
        if (mutedUsers.has(socket.id)) {
            socket.emit('system_message', 'あなたは現在ミュートされているため発言できません。');
            return;
        }

        const text = msg.trim();

        // コマンドの解析
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

        // 通常チャット送信
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

    // 切断時
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
