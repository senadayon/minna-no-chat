const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');


app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// 簡易的なユーザーデータベース（本番はMongoDBなどに保存）
const users = {}; 


// ログイン・新規登録用のAPI
app.post('/api/register', (req, res) => {
    const { username, password, isAdmin } = req.body;
    if (users[username]) return res.json({ success: false, message: '既に存在するユーザー名です' });
    
    // 権限の設定（チェックがあればadmin、なければuser）
    const role = isAdmin ? 'admin' : 'user';
    users[username] = { password, role };
    res.json({ success: true });
});


app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (!user || user.password !== password) {
        return res.json({ success: false, message: 'ユーザー名またはパスワードが違います' });
    }
    res.json({ success: true, role: user.role });
});


// 通信（Socket.io）の処理
io.on('connection', (socket) => {
    let currentUser = null;


    socket.on('join', ({ username, role }) => {
        currentUser = { username, role };
        io.emit('system_message', `${username}がチャットに参加しました`);
    });


    socket.on('chat_message', (msg) => {
        if (!currentUser) return;


        // コマンドの処理（/delete など）
        if (msg.startsWith('/')) {
            handleCommand(socket, msg);
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


// 管理者コマンドの判定関数
function handleCommand(socket, msg) {
    // ここに /mute や /ban などの処理を足していきます！
}


http.listen(3000, () => {
    console.log('サーバーがポート3000で起動しました');
});