const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("snaploop", {
    register: (username, password) => ipcRenderer.invoke("register", username, password),
    login: (username, password) => ipcRenderer.invoke("login", username, password),

    chooseMedia: () => ipcRenderer.invoke("chooseMedia"),
    createPost: (username, content, mediaPath = "") => ipcRenderer.invoke("createPost", username, content, mediaPath),
    getPosts: () => ipcRenderer.invoke("getPosts"),
    getSavedPosts: (username) => ipcRenderer.invoke("getSavedPosts", username),

    likePost: (postId, username) => ipcRenderer.invoke("likePost", postId, username),
    getLikes: (postId) => ipcRenderer.invoke("getLikes", postId),
    savePost: (postId, username) => ipcRenderer.invoke("savePost", postId, username),

    addComment: (postId, username, comment) => ipcRenderer.invoke("addComment", postId, username, comment),
    getComments: (postId) => ipcRenderer.invoke("getComments", postId),

    getProfile: (username, viewer = "") => ipcRenderer.invoke("getProfile", username, viewer),
    updateProfile: (username, bio, avatar) => ipcRenderer.invoke("updateProfile", username, bio, avatar),
    followUser: (follower, following) => ipcRenderer.invoke("followUser", follower, following),

    getNotifications: (username) => ipcRenderer.invoke("getNotifications", username),

    sendMessage: (sender, receiver, content) => ipcRenderer.invoke("sendMessage", sender, receiver, content),
    getMessages: (user1, user2) => ipcRenderer.invoke("getMessages", user1, user2),
    getInboxUsers: (username) => ipcRenderer.invoke("getInboxUsers", username),

    adminGetUsers: (adminUsername) => ipcRenderer.invoke("adminGetUsers", adminUsername),
    adminCreateUser: (adminUsername, username, password, isAdmin) => ipcRenderer.invoke("adminCreateUser", adminUsername, username, password, isAdmin),
    adminSetUserAdmin: (adminUsername, targetUsername, isAdmin) => ipcRenderer.invoke("adminSetUserAdmin", adminUsername, targetUsername, isAdmin),
    adminDeleteUser: (adminUsername, targetUsername) => ipcRenderer.invoke("adminDeleteUser", adminUsername, targetUsername)
});
