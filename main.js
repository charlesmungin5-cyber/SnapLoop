const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const dbFolder = path.join(app.getPath("userData"), "database");

if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
}

const db = new sqlite3.Database(
    path.join(dbFolder, "snaploop.db")
);
const uploadsDir = path.join(app.getPath("userData"), "uploads");
const imageDir = path.join(uploadsDir, "images");
const videoDir = path.join(uploadsDir, "videos");

function run(sql, params = []) {
    return new Promise((resolve) => {
        db.run(sql, params, function (err) {
            resolve({ err, lastID: this?.lastID, changes: this?.changes || 0 });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve) => {
        db.get(sql, params, (err, row) => resolve(err ? null : row));
    });
}

function all(sql, params = []) {
    return new Promise((resolve) => {
        db.all(sql, params, (err, rows) => resolve(err ? [] : rows));
    });
}

function formatJoinDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

function intBool(value) {
    return value ? 1 : 0;
}

function validateCredentials(username, password) {
    const cleanUser = String(username || "").trim();
    const cleanPass = String(password || "").trim();
    if (cleanUser.length < 3 || cleanUser.length > 25) return "Username must be between 3 and 25 characters.";
    if (cleanPass.length < 3 || cleanPass.length > 25) return "Password must be between 3 and 25 characters.";
    return "";
}

function publicUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        bio: row.bio || "",
        avatar: row.avatar || ":)",
        join_date: row.join_date || "",
        is_admin: Boolean(row.is_admin)
    };
}

async function ensureColumn(table, column, definition) {
    const rows = await all(`PRAGMA table_info(${table})`);
    if (!rows.some((row) => row.name === column)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

function ensureUploadFolders() {
    fs.mkdirSync(imageDir, { recursive: true });
    fs.mkdirSync(videoDir, { recursive: true });
}

function mediaKind(filePath = "") {
    const ext = path.extname(filePath).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) return "image";
    if ([".mp4", ".mov", ".mkv", ".webm", ".avi"].includes(ext)) return "video";
    return "text";
}

function copyUpload(sourcePath) {
    if (!sourcePath) return { mediaPath: "", mediaType: "text" };
    ensureUploadFolders();
    const type = mediaKind(sourcePath);
    const targetFolder = type === "video" ? videoDir : imageDir;
    const safeName = `${Date.now()}-${path.basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const destination = path.join(targetFolder, safeName);
    fs.copyFileSync(sourcePath, destination);
    return {
        mediaPath: path.relative(__dirname, destination).replace(/\\/g, "/"),
        mediaType: type
    };
}

async function notify(username, message) {
    if (!username || !message) return;
    await run("INSERT INTO notifications(username,message) VALUES(?,?)", [username, message]);
}

async function initDatabase() {
    ensureUploadFolders();

    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            bio TEXT DEFAULT '',
            avatar TEXT DEFAULT ':)',
            join_date TEXT,
            is_admin INTEGER DEFAULT 0
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            content TEXT,
            media_path TEXT DEFAULT '',
            media_type TEXT DEFAULT 'text',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`CREATE TABLE IF NOT EXISTS followers (id INTEGER PRIMARY KEY AUTOINCREMENT, follower TEXT, following TEXT, UNIQUE(follower, following))`);
    await run(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, receiver TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, filename TEXT, media_type TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, username TEXT, comment TEXT)`);
    await run(`CREATE TABLE IF NOT EXISTS likes (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, username TEXT)`);
    await run(`CREATE TABLE IF NOT EXISTS saved_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, username TEXT, UNIQUE(post_id, username))`);

    await ensureColumn("users", "bio", "TEXT DEFAULT ''");
    await ensureColumn("users", "avatar", "TEXT DEFAULT ':)'");
    await ensureColumn("users", "join_date", "TEXT");
    await ensureColumn("users", "is_admin", "INTEGER DEFAULT 0");
    await ensureColumn("posts", "media_path", "TEXT DEFAULT ''");
    await ensureColumn("posts", "media_type", "TEXT DEFAULT 'text'");
    await ensureColumn("likes", "username", "TEXT");

    await run("UPDATE users SET join_date=? WHERE join_date IS NULL OR join_date=''", [formatJoinDate()]);
    await run("UPDATE posts SET media_type='text' WHERE media_type IS NULL OR media_type='' ");

    const starterUsers = [
        ["admin", "admin", "SnapLoop admin channel. Use this account to manage users.", "AD", "4/19/26", 1],
        ["creator", "123", "Posting daily clips and creator updates.", "CR", "4/20/26", 0],
        ["viewer", "123", "Here to watch, like, and comment.", "VW", "4/21/26", 0]
    ];

    for (const user of starterUsers) {
        await run("INSERT OR IGNORE INTO users(username,password,bio,avatar,join_date,is_admin) VALUES(?,?,?,?,?,?)", user);
    }

    const postCount = await get("SELECT COUNT(*) AS total FROM posts");
    if (!postCount || postCount.total === 0) {
        await run("INSERT INTO posts(username,content,media_type) VALUES(?,?,?)", ["creator", "My gaming montage", "text"]);
        await run("INSERT INTO posts(username,content,media_type) VALUES(?,?,?)", ["admin", "Admin panel is ready. Add users, promote admins, and manage accounts.", "text"]);
    }

    const adminCount = await get("SELECT COUNT(*) AS total FROM users WHERE is_admin=1");
    if (!adminCount || adminCount.total === 0) {
        const firstUser = await get("SELECT id FROM users ORDER BY id ASC LIMIT 1");
        if (firstUser) await run("UPDATE users SET is_admin=1 WHERE id=?", [firstUser.id]);
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: { preload: path.join(__dirname, "preload.js") }
    });
    win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(async () => {
    await initDatabase();
    createWindow();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("register", async (event, username, password) => {
    username = String(username || "").trim();
    password = String(password || "").trim();
    const validation = validateCredentials(username, password);
    if (validation) return { success: false, message: validation };
    if (await get("SELECT id FROM users WHERE username=?", [username])) return { success: false, message: "Username already exists." };
    const count = await get("SELECT COUNT(*) AS total FROM users");
    const isFirstUser = !count || count.total === 0;
    const result = await run("INSERT INTO users(username,password,bio,avatar,join_date,is_admin) VALUES(?,?,?,?,?,?)", [username, password, "New to SnapLoop.", username.slice(0, 2).toUpperCase(), formatJoinDate(), intBool(isFirstUser)]);
    return { success: !result.err, message: result.err ? "Could not create account." : "Account created." };
});

ipcMain.handle("login", async (event, username, password) => {
    username = String(username || "").trim();
    password = String(password || "").trim();
    if (!username || !password) return { success: false, message: "Enter your username and password." };
    const user = await get("SELECT * FROM users WHERE username=?", [username]);
    if (!user) return { success: false, message: "Username is incorrect." };
    if (user.password !== password) return { success: false, message: "Password is incorrect." };
    return { success: true, username: user.username, isAdmin: Boolean(user.is_admin), profile: publicUser(user) };
});

ipcMain.handle("chooseMedia", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [
            { name: "Media", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "mov", "mkv", "webm", "avi"] },
            { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
            { name: "Videos", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }
        ]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return { path: result.filePaths[0], type: mediaKind(result.filePaths[0]), name: path.basename(result.filePaths[0]) };
});

ipcMain.handle("createPost", async (event, username, content, sourcePath = "") => {
    const upload = copyUpload(sourcePath);
    const result = await run("INSERT INTO posts(username,content,media_path,media_type) VALUES(?,?,?,?)", [username, content, upload.mediaPath, upload.mediaType]);
    return { success: !result.err, id: result.lastID };
});

ipcMain.handle("getPosts", async () => {
    return all(`
        SELECT p.*, u.avatar,
               (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS like_count,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comment_count,
               (SELECT COUNT(*) FROM saved_posts WHERE post_id=p.id) AS save_count
        FROM posts p
        LEFT JOIN users u ON u.username=p.username
        ORDER BY p.id DESC
    `);
});

ipcMain.handle("likePost", async (event, postId, username = "") => {
    const result = await run("INSERT INTO likes(post_id,username) VALUES(?,?)", [postId, username]);
    const post = await get("SELECT username FROM posts WHERE id=?", [postId]);
    if (post && username && post.username !== username) await notify(post.username, `${username} liked your post`);
    return !result.err;
});

ipcMain.handle("getLikes", async (event, postId) => {
    const row = await get("SELECT COUNT(*) as total FROM likes WHERE post_id=?", [postId]);
    return row ? row.total : 0;
});

ipcMain.handle("savePost", async (event, postId, username) => {
    const result = await run("INSERT OR IGNORE INTO saved_posts(post_id,username) VALUES(?,?)", [postId, username]);
    return { success: !result.err };
});

ipcMain.handle("getSavedPosts", async (event, username) => {
    return all(`
        SELECT p.*, u.avatar,
               (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS like_count,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comment_count,
               (SELECT COUNT(*) FROM saved_posts WHERE post_id=p.id) AS save_count
        FROM saved_posts s
        JOIN posts p ON p.id=s.post_id
        LEFT JOIN users u ON u.username=p.username
        WHERE s.username=?
        ORDER BY s.id DESC
    `, [username]);
});

ipcMain.handle("addComment", async (event, postId, username, comment) => {
    const result = await run("INSERT INTO comments(post_id,username,comment) VALUES(?,?,?)", [postId, username, comment]);
    const post = await get("SELECT username FROM posts WHERE id=?", [postId]);
    if (post && post.username !== username) await notify(post.username, `${username} commented: ${comment}`);
    return !result.err;
});

ipcMain.handle("getComments", async (event, postId) => all("SELECT * FROM comments WHERE post_id=?", [postId]));

ipcMain.handle("getProfile", async (event, username, viewer = "") => {
    const row = await get("SELECT * FROM users WHERE username=?", [username]);
    if (!row) return null;
    const followers = await get("SELECT COUNT(*) AS total FROM followers WHERE following=?", [username]);
    const following = await get("SELECT COUNT(*) AS total FROM followers WHERE follower=?", [username]);
    const posts = await all("SELECT * FROM posts WHERE username=? ORDER BY id DESC", [username]);
    const likedPosts = await all("SELECT p.* FROM likes l JOIN posts p ON p.id=l.post_id WHERE l.username=? ORDER BY l.id DESC", [username]);
    const savedPosts = await all("SELECT p.* FROM saved_posts s JOIN posts p ON p.id=s.post_id WHERE s.username=? ORDER BY s.id DESC", [username]);
    const isFollowing = viewer ? Boolean(await get("SELECT 1 FROM followers WHERE follower=? AND following=?", [viewer, username])) : false;
    return { ...publicUser(row), followers: followers?.total || 0, following: following?.total || 0, posts, likedPosts, savedPosts, isFollowing };
});

ipcMain.handle("updateProfile", async (event, username, bio, avatar) => {
    const result = await run("UPDATE users SET bio=?, avatar=? WHERE username=?", [bio, avatar, username]);
    return !result.err;
});

ipcMain.handle("followUser", async (event, follower, following) => {
    if (!follower || !following || follower === following) return { success: false };
    const result = await run("INSERT OR IGNORE INTO followers(follower,following) VALUES(?,?)", [follower, following]);
    if (!result.err) await notify(following, `${follower} followed you`);
    return { success: !result.err };
});

ipcMain.handle("getNotifications", async (event, username) => all("SELECT * FROM notifications WHERE username=? ORDER BY id DESC", [username]));

ipcMain.handle("sendMessage", async (event, sender, receiver, content) => {
    const result = await run("INSERT INTO messages(sender,receiver,content) VALUES(?,?,?)", [sender, receiver, content]);
    if (!result.err) await notify(receiver, `${sender} sent you a message`);
    return { success: !result.err };
});

ipcMain.handle("getMessages", async (event, user1, user2) => {
    return all("SELECT * FROM messages WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?) ORDER BY id ASC", [user1, user2, user2, user1]);
});

ipcMain.handle("getInboxUsers", async (event, username) => {
    return all(`
        SELECT DISTINCT CASE WHEN sender=? THEN receiver ELSE sender END AS username
        FROM messages
        WHERE sender=? OR receiver=?
        ORDER BY username ASC
    `, [username, username, username]);
});

ipcMain.handle("adminGetUsers", async (event, adminUsername) => {
    const admin = await get("SELECT is_admin FROM users WHERE username=?", [adminUsername]);
    if (!admin || !admin.is_admin) return [];
    return all("SELECT id, username, bio, avatar, join_date, is_admin FROM users ORDER BY id ASC");
});

ipcMain.handle("adminCreateUser", async (event, adminUsername, username, password, isAdmin) => {
    const admin = await get("SELECT is_admin FROM users WHERE username=?", [adminUsername]);
    if (!admin || !admin.is_admin) return { success: false, message: "Admin access required." };
    username = String(username || "").trim();
    password = String(password || "").trim();
    const validation = validateCredentials(username, password);
    if (validation) return { success: false, message: validation };
    const result = await run("INSERT INTO users(username,password,bio,avatar,join_date,is_admin) VALUES(?,?,?,?,?,?)", [username, password, "Created by admin.", username.slice(0, 2).toUpperCase(), formatJoinDate(), intBool(isAdmin)]);
    if (result.err) return { success: false, message: "Username already exists." };
    return { success: true, message: "User added." };
});

ipcMain.handle("adminSetUserAdmin", async (event, adminUsername, targetUsername, isAdmin) => {
    if (adminUsername === targetUsername) return { success: false, message: "You cannot change your own admin status." };
    const admin = await get("SELECT is_admin FROM users WHERE username=?", [adminUsername]);
    if (!admin || !admin.is_admin) return { success: false, message: "Admin access required." };
    const result = await run("UPDATE users SET is_admin=? WHERE username=?", [intBool(isAdmin), targetUsername]);
    return { success: !result.err, message: result.err ? "Could not update user." : "User updated." };
});

ipcMain.handle("adminDeleteUser", async (event, adminUsername, targetUsername) => {
    if (adminUsername === targetUsername) return { success: false, message: "You cannot delete your own account from admin." };
    const admin = await get("SELECT is_admin FROM users WHERE username=?", [adminUsername]);
    if (!admin || !admin.is_admin) return { success: false, message: "Admin access required." };
    await run("DELETE FROM comments WHERE username=?", [targetUsername]);
    await run("DELETE FROM posts WHERE username=?", [targetUsername]);
    await run("DELETE FROM followers WHERE follower=? OR following=?", [targetUsername, targetUsername]);
    await run("DELETE FROM messages WHERE sender=? OR receiver=?", [targetUsername, targetUsername]);
    const result = await run("DELETE FROM users WHERE username=?", [targetUsername]);
    return { success: !result.err, message: result.err ? "Could not delete user." : "User deleted." };
});
