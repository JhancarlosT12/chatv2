require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const sanitizeHtml = require('sanitize-html');
const path = require('path');

const app = express();

// Configure multer to use /tmp for file uploads
const upload = multer({ 
    dest: '/tmp/',
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com'
});

// Nota: En Vercel, las variables en memoria se reinician en cada invocación.
// Considera usar Vercel KV o una base de datos para persistir chatbots y conversations.
const chatbots = {};
const conversations = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const validateChatbotId = (req, res, next) => {
    const chatbotId = req.params.id;
    if (!chatbots[chatbotId]) {
        return res.status(404).json({ error: 'Chatbot no encontrado' });
    }
    next();
};

app.post('/api/upload', upload.single('document'), async (req, res) => {
    let filePath;
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'No se proporcionó ningún archivo' });
        }

        filePath = file.path;
        let text = '';

        if (file.mimetype === 'application/pdf') {
            const dataBuffer = await fs.readFile(file.path);
            const pdfData = await pdfParse(dataBuffer);
            text = pdfData.text;
        } else if (file.mimetype === 'text/plain') {
            text = await fs.readFile(file.path, 'utf-8');
        } else {
            await fs.unlink(file.path).catch((err) => console.error('Error al eliminar archivo:', err));
            return res.status(400).json({ success: false, message: 'Formato no soportado' });
        }

        const chatbotId = uuidv4();
        chatbots[chatbotId] = { knowledge: text, createdAt: Date.now() };
        conversations[chatbotId] = { context: null, history: [] };

        await fs.unlink(file.path).catch((err) => console.error('Error al eliminar archivo:', err));

        res.json({ success: true, chatbotId });
    } catch (error) {
        console.error('Error al procesar documento:', error);
        if (filePath) {
            await fs.unlink(filePath).catch((err) => console.error('Error al eliminar archivo:', err));
        }
        res.status(500).json({ success: false, message: 'Error al procesar el documento' });
    }
});

app.get('/chatbot/:id', validateChatbotId, (req, res) => {
    const chatbotId = req.params.id;
    const primaryColor = sanitizeHtml(req.query.color || '#007bff');
    const botName = sanitizeHtml(req.query.name || 'Asistente');
    const mode = req.query.mode || 'bubble';
    const bubbleIcon = sanitizeHtml(req.query.icon || '💬');

    function adjustColor(hex, percent) {
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);

        r = Math.min(255, Math.max(0, r + (r * percent) / 100));
        g = Math.min(255, Math.max(0, g + (g * percent) / 100));
        b = Math.min(255, Math.max(0, b + (b * percent) / 100));

        return '#' + Math.round(r).toString(16).padStart(2, '0') +
                    Math.round(g).toString(16).padStart(2, '0') +
                    Math.round(b).toString(16).padStart(2, '0');
    }

    if (mode === 'iframe') {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: 'Arial', sans-serif;
                        margin: 0;
                        padding: 0;
                        background: transparent;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        overflow: hidden;
                    }
                    
                    #chat-header {
                        padding: 15px;
                        background: ${primaryColor};
                        color: white;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-top-left-radius: 15px;
                        border-top-right-radius: 15px;
                    }
                    
                    #chat-title {
                        font-weight: bold;
                        font-size: 18px;
                    }
                    
                    #chat-close {
                        background: none;
                        border: none;
                        color: white;
                        font-size: 20px;
                        cursor: pointer;
                    }
                    
                    #chat {
                        flex: 1;
                        overflow-y: auto;
                        padding: 20px;
                        background: #f5f7fa;
                    }
                    
                    .message {
                        margin: 0;
                        padding: 0;
                        margin-bottom: 20px;
                        display: flex;
                        align-items: flex-start;
                        opacity: 0;
                    }
                    
                    .user-message {
                        justify-content: flex-end;
                        animation: slideInRight 0.3s ease forwards;
                    }
                    
                    .bot-message {
                        justify-content: flex-start;
                        animation: slideInLeft 0.3s ease forwards;
                    }
                    
                    .message-content {
                        max-width: 75%;
                        padding: 12px 18px;
                        border-radius: 20px;
                        line-height: 1.5;
                        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                        word-wrap: break-word;
                    }
                    
                    .user-message .message-content {
                        background: ${primaryColor};
                        color: white;
                        border-bottom-right-radius: 5px;
                    }
                    
                    .bot-message .message-content {
                        background: white;
                        color: #333;
                        border-bottom-left-radius: 5px;
                    }
                    
                    .typing {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        padding: 12px 18px;
                        opacity: 0;
                        animation: fadeIn 0.3s ease forwards;
                    }
                    
                    .dot {
                        width: 10px;
                        height: 10px;
                        background: #999;
                        border-radius: 50%;
                        animation: pulse 1.2s infinite;
                    }
                    
                    .dot:nth-child(2) {
                        animation-delay: 0.3s;
                    }
                    
                    .dot:nth-child(3) {
                        animation-delay: 0.6s;
                    }
                    
                    #input-container {
                        display: flex;
                        padding: 12px;
                        background: #fff;
                        border-top: 1px solid #e5e7eb;
                    }
                    
                    #input {
                        flex: 1;
                        padding: 12px;
                        border: 1px solid #d1d5db;
                        border-radius: 25px;
                        font-size: 16px;
                        outline: none;
                        margin-right: 12px;
                        transition: border-color 0.2s;
                    }
                    
                    #input:focus {
                        border-color: ${primaryColor};
                    }
                    
                    #send-btn {
                        background: ${primaryColor};
                        color: white;
                        border: none;
                        border-radius: 25px;
                        padding: 12px 24px;
                        cursor: pointer;
                        font-size: 16px;
                        transition: background 0.2s;
                    }
                    
                    #send-btn:hover {
                        background: ${adjustColor(primaryColor, -20)};
                    }
                    
                    .message-content p {
                        margin: 0 0 10px 0;
                    }
                    
                    .message-content p:last-child {
                        margin-bottom: 0;
                    }
                    
                    .message-content hr {
                        border: 0;
                        height: 1px;
                        background: rgba(0, 0, 0, 0.1);
                        margin: 8px 0;
                    }
                    
                    .message-content a {
                        color: ${primaryColor};
                        text-decoration: underline;
                        word-break: break-all;
                    }
                    
                    .bot-message .message-content a {
                        font-weight: 500;
                    }
                    
                    .message-content strong {
                        font-weight: 600;
                    }
                    
                    @keyframes slideInRight {
                        from { opacity: 0; transform: translateX(20px); }
                        to { opacity: 1; transform: translateX(0); }
                    }
                    
                    @keyframes slideInLeft {
                        from { opacity: 0; transform: translateX(-20px); }
                        to { opacity: 1; transform: translateX(0); }
                    }
                    
                    @keyframes fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    
                    @keyframes fadeOut {
                        from { opacity: 1; }
                        to { opacity: 0; }
                    }
                    
                    @keyframes pulse {
                        0%, 100% { transform: scale(1); opacity: 0.5; }
                        50% { transform: scale(1.2); opacity: 1; }
                    }
                </style>
            </head>
            <body>
                <div id="chat-header">
                    <div id="chat-title">${sanitizeHtml(botName)}</div>
                    <button id="chat-close">✕</button>
                </div>
                <div id="chat"></div>
                <div id="input-container">
                    <input id="input" placeholder="Escribe tu mensaje...">
                    <button id="send-btn">Enviar</button>
                </div>
                
                <script>
                    const chatClose = document.getElementById('chat-close');
                    const chat = document.getElementById('chat');
                    const input = document.getElementById('input');
                    const sendBtn = document.getElementById('send-btn');
                    
                    chatClose.addEventListener('click', () => {
                        window.parent.postMessage('closeChat', '*');
                    });
                    
                    addMessage('bot', '¡Hola! ¿En qué te puedo ayudar hoy?');
                    
                    sendBtn.addEventListener('click', sendMessage);
                    
                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && input.value.trim()) {
                            sendMessage();
                        }
                    });
                    
                    async function sendMessage() {
                        const userMessage = input.value.trim();
                        if (!userMessage) return;
                        
                        addMessage('user', userMessage);
                        input.value = '';
                        
                        showTyping();
                        
                        try {
                            const response = await fetch('/api/chat/${chatbotId}', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ message: userMessage })
                            });
                            
                            if (!response.ok) {
                                throw new Error('Error en la respuesta del servidor');
                            }
                            
                            const result = await response.json();
                            hideTyping();
                            addMessage('bot', result.reply);
                            
                            window.parent.postMessage('newMessage', '*');
                        } catch (error) {
                            console.error('Error:', error);
                            hideTyping();
                            addMessage('bot', 'Lo siento, hubo un error. ¿Puedes intentarlo de nuevo?');
                        }
                        
                        chat.scrollTop = chat.scrollHeight;
                    }
                    
                    function addMessage(sender, text) {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'message ' + (sender === 'user' ? 'user-message' : 'bot-message');
                        
                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';
                        
                        let formattedText = text.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
                        formattedText = formattedText.replace(
                            /(https?:\\/\\/[^\\s]+)/g, 
                            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
                        );
                        formattedText = formattedText
                            .replace(/\\n\\n/g, '</p><hr><p>')
                            .replace(/\\n/g, '</p><p>');
                        formattedText = '<p>' + formattedText + '</p>';
                        
                        contentDiv.innerHTML = ${sanitizeHtml.name}(
                            formattedText, 
                            {
                                allowedTags: ['p', 'strong', 'a', 'hr'],
                                allowedAttributes: { 'a': ['href', 'target', 'rel'] }
                            }
                        );
                        
                        messageDiv.appendChild(contentDiv);
                        chat.appendChild(messageDiv);
                        chat.scrollTop = chat.scrollHeight;
                    }
                    
                    function showTyping() {
                        const typingDiv = document.createElement('div');
                        typingDiv.id = 'typing-indicator';
                        typingDiv.className = 'typing bot-message';
                        typingDiv.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
                        chat.appendChild(typingDiv);
                        chat.scrollTop = chat.scrollHeight;
                    }
                    
                    function hideTyping() {
                        const typingDiv = document.getElementById('typing-indicator');
                        if (typingDiv) typingDiv.remove();
                    }
                    
                    function restartChat() {
                        chat.style.animation = 'fadeOut 0.3s ease forwards';
                        setTimeout(() => {
                            chat.innerHTML = '';
                            chat.style.animation = 'fadeIn 0.3s ease forwards';
                            addMessage('bot', '¡Hola! ¿En qué te puedo ayudar hoy?');
                            fetch('/api/reset/${chatbotId}', { method: 'POST' });
                        }, 300);
                    }
                </script>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: 'Arial', sans-serif;
                        margin: 0;
                        padding: 0;
                        background: transparent;
                    }
                    
                    #chat-container {
                        position: fixed;
                        bottom: 80px;
                        right: 20px;
                        width: 350px;
                        height: 500px;
                        background: #fff;
                        border-radius: 15px;
                        box-shadow: 0 5px 25px rgba(0, 0, 0, 0.15);
                        display: flex;
                        flex-direction: column;
                        overflow: hidden;
                        transition: all 0.3s ease;
                        opacity: 0;
                        transform: translateY(20px);
                        pointer-events: none;
                        z-index: 9999;
                    }
                    
                    #chat-container.open {
                        opacity: 1;
                        transform: translateY(0);
                        pointer-events: all;
                    }
                    
                    #chat-header {
                        padding: 15px;
                        background: ${primaryColor};
                        color: white;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-top-left-radius: 15px;
                        border-top-right-radius: 15px;
                    }
                    
                    #chat-title {
                        font-weight: bold;
                        font-size: 18px;
                    }
                    
                    #chat-close {
                        background: none;
                        border: none;
                        color: white;
                        font-size: 20px;
                        cursor: pointer;
                    }
                    
                    #chat {
                        flex: 1;
                        overflow-y: auto;
                        padding: 20px;
                        background: #f5f7fa;
                    }
                    
                    .message {
                        margin: 0;
                        padding: 0;
                        margin-bottom: 20px;
                        display: flex;
                        align-items: flex-start;
                        opacity: 0;
                    }
                    
                    .user-message {
                        justify-content: flex-end;
                        animation: slideInRight 0.3s ease forwards;
                    }
                    
                    .bot-message {
                        justify-content: flex-start;
                        animation: slideInLeft 0.3s ease forwards;
                    }
                    
                    .message-content {
                        max-width: 75%;
                        padding: 12px 18px;
                        border-radius: 20px;
                        line-height: 1.5;
                        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                        word-wrap: break-word;
                    }
                    
                    .user-message .message-content {
                        background: ${primaryColor};
                        color: white;
                        border-bottom-right-radius: 5px;
                    }
                    
                    .bot-message .message-content {
                        background: white;
                        color: #333;
                        border-bottom-left-radius: 5px;
                    }
                    
                    .typing {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        padding: 12px 18px;
                        opacity: 0;
                        animation: fadeIn 0.3s ease forwards;
                    }
                    
                    .dot {
                        width: 10px;
                        height: 10px;
                        background: #999;
                        border-radius: 50%;
                        animation: pulse 1.2s infinite;
                    }
                    
                    .dot:nth-child(2) {
                        animation-delay: 0.3s;
                    }
                    
                    .dot:nth-child(3) {
                        animation-delay: 0.6s;
                    }
                    
                    #input-container {
                        display: flex;
                        padding: 12px;
                        background: #fff;
                        border-top: 1px solid #e5e7eb;
                    }
                    
                    #input {
                        flex: 1;
                        padding: 12px;
                        border: 1px solid #d1d5db;
                        border-radius: 25px;
                        font-size: 16px;
                        outline: none;
                        margin-right: 12px;
                        transition: border-color 0.2s;
                    }
                    
                    #input:focus {
                        border-color: ${primaryColor};
                    }
                    
                    #send-btn {
                        background: ${primaryColor};
                        color: white;
                        border: none;
                        border-radius: 25px;
                        padding: 12px 24px;
                        cursor: pointer;
                        font-size: 16px;
                        transition: background 0.2s;
                    }
                    
                    #send-btn:hover {
                        background: ${adjustColor(primaryColor, -20)};
                    }
                    
                    #chat-bubble {
                        position: fixed;
                        bottom: 20px;
                        right: 20px;
                        width: 60px;
                        height: 60px;
                        background: ${primaryColor};
                        border-radius: 50%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        color: white;
                        font-size: 24px;
                        cursor: pointer;
                        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                        z-index: 9999;
                        transition: transform 0.3s, box-shadow 0.3s;
                    }
                    
                    #chat-bubble:hover {
                        transform: scale(1.05);
                        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
                    }
                    
                    #notification-badge {
                        position: absolute;
                        top: -5px;
                        right: -5px;
                        background: #FF5252;
                        color: white;
                        border-radius: 50%;
                        width: 20px;
                        height: 20px;
                        font-size: 12px;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        opacity: 0;
                        transition: opacity 0.3s;
                    }
                    
                    #notification-badge.active {
                        opacity: 1;
                    }
                    
                    .message-content p {
                        margin: 0 0 10px 0;
                    }
                    
                    .message-content p:last-child {
                        margin-bottom: 0;
                    }
                    
                    .message-content hr {
                        border: 0;
                        height: 1px;
                        background: rgba(0, 0, 0, 0.1);
                        margin: 8px 0;
                    }
                    
                    .message-content a {
                        color: ${primaryColor};
                        text-decoration: underline;
                        word-break: break-all;
                    }
                    
                    .bot-message .message-content a {
                        font-weight: 500;
                    }
                    
                    .message-content strong {
                        font-weight: 600;
                    }
                    
                    @keyframes slideInRight {
                        from { opacity: 0; transform: translateX(20px); }
                        to { opacity: 1; transform: translateX(0); }
                    }
                    
                    @keyframes slideInLeft {
                        from { opacity: 0; transform: translateX(-20px); }
                        to { opacity: 1; transform: translateX(0); }
                    }
                    
                    @keyframes fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    
                    @keyframes fadeOut {
                        from { opacity: 1; }
                        to { opacity: 0; }
                    }
                    
                    @keyframes pulse {
                        0%, 100% { transform: scale(1); opacity: 0.5; }
                        50% { transform: scale(1.2); opacity: 1; }
                    }
                    
                    @media (max-width: 480px) {
                        #chat-container {
                            width: calc(100% - 40px);
                            height: calc(100% - 100px);
                        }
                    }
                </style>
            </head>
            <body>
                <div id="chat-bubble">
                    ${sanitizeHtml(bubbleIcon)}
                    <div id="notification-badge">1</div>
                </div>
                
                <div id="chat-container">
                    <div id="chat-header">
                        <div id="chat-title">${sanitizeHtml(botName)}</div>
                        <button id="chat-close">✕</button>
                    </div>
                    <div id="chat"></div>
                    <div id="input-container">
                        <input id="input" placeholder="Escribe tu mensaje...">
                        <button id="send-btn">Enviar</button>
                    </div>
                </div>
                
                <script>
                    const chatBubble = document.getElementById('chat-bubble');
                    const chatContainer = document.getElementById('chat-container');
                    const chatClose = document.getElementById('chat-close');
                    const notificationBadge = document.getElementById('notification-badge');
                    const chat = document.getElementById('chat');
                    const input = document.getElementById('input');
                    const sendBtn = document.getElementById('send-btn');
                    
                    setTimeout(() => {
                        notificationBadge.classList.add('active');
                    }, 2000);
                    
                    chatBubble.addEventListener('click', () => {
                        chatContainer.classList.add('open');
                        notificationBadge.classList.remove('active');
                    });
                    
                    chatClose.addEventListener('click', () => {
                        chatContainer.classList.remove('open');
                    });
                    
                    addMessage('bot', '¡Hola! ¿En qué te puedo ayudar hoy?');
                    
                    sendBtn.addEventListener('click', sendMessage);
                    
                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && input.value.trim()) {
                            sendMessage();
                        }
                    });
                    
                    async function sendMessage() {
                        const userMessage = input.value.trim();
                        if (!userMessage) return;
                        
                        addMessage('user', userMessage);
                        input.value = '';
                        
                        showTyping();
                        
                        try {
                            const response = await fetch('/api/chat/${chatbotId}', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ message: userMessage })
                            });
                            
                            if (!response.ok) {
                                throw new Error('Error en la respuesta del servidor');
                            }
                            
                            const result = await response.json();
                            hideTyping();
                            addMessage('bot', result.reply);
                        } catch (error) {
                            console.error('Error:', error);
                            hideTyping();
                            addMessage('bot', 'Lo siento, hubo un error. ¿Puedes intentarlo de nuevo?');
                        }
                        
                        chat.scrollTop = chat.scrollHeight;
                    }
                    
                    function addMessage(sender, text) {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'message ' + (sender === 'user' ? 'user-message' : 'bot-message');
                        
                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';
                        
                        let formattedText = text.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
                        formattedText = formattedText.replace(
                            /(https?:\\/\\/[^\\s]+)/g, 
                            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
                        );
                        formattedText = formattedText
                            .replace(/\\n\\n/g, '</p><hr><p>')
                            .replace(/\\n/g, '</p><p>');
                        formattedText = '<p>' + formattedText + '</p>';
                        
                        contentDiv.innerHTML = ${sanitizeHtml.name}(
                            formattedText, 
                            {
                                allowedTags: ['p', 'strong', 'a', 'hr'],
                                allowedAttributes: { 'a': ['href', 'target', 'rel'] }
                            }
                        );
                        
                        messageDiv.appendChild(contentDiv);
                        chat.appendChild(messageDiv);
                        chat.scrollTop = chat.scrollHeight;
                        
                        if (sender === 'bot' && !chatContainer.classList.contains('open')) {
                            notificationBadge.classList.add('active');
                        }
                    }
                    
                    function showTyping() {
                        const typingDiv = document.createElement('div');
                        typingDiv.id = 'typing-indicator';
                        typingDiv.className = 'typing bot-message';
                        typingDiv.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
                        chat.appendChild(typingDiv);
                        chat.scrollTop = chat.scrollHeight;
                    }
                    
                    function hideTyping() {
                        const typingDiv = document.getElementById('typing-indicator');
                        if (typingDiv) typingDiv.remove();
                    }
                    
                    function restartChat() {
                        chat.style.animation = 'fadeOut 0.3s ease forwards';
                        setTimeout(() => {
                            chat.innerHTML = '';
                            chat.style.animation = 'fadeIn 0.3s ease forwards';
                            addMessage('bot', '¡Hola! ¿En qué te puedo ayudar hoy?');
                            fetch('/api/reset/${chatbotId}', { method: 'POST' });
                        }, 300);
                    }
                </script>
            </body>
            </html>
        `);
    }
});

app.post('/chat/:id', validateChatbotId, async (req, res) => {
    const chatbotId = req.params.id;
    const userMessage = sanitizeHtml(req.body.message || '');

    if (!userMessage) {
        return res.status(400).json({ error: 'Mensaje vacío' });
    }

    if (userMessage.length > 1000) {
        return res.status(400).json({ error: 'El mensaje excede el límite de 1000 caracteres' });
    }

    const knowledge = chatbots[chatbotId].knowledge;
    const conversation = conversations[chatbotId];

    try {
        let reply = await generateDeepSeekResponse(userMessage, knowledge, conversation);

        if (userMessage.toLowerCase().includes('apartado 360')) {
            conversation.context = 'apartado_360';
        } else if (userMessage.toLowerCase().includes('adiós') || userMessage.toLowerCase().includes('bye')) {
            conversation.context = null;
            reply = '¡Hasta pronto! Si necesitas ayuda, aquí estaré.';
        } else if (userMessage.toLowerCase().includes('gracias')) {
            reply = '¡De nada! ¿Algo más en lo que pueda ayudarte?';
        }

        conversation.history.push({ role: 'user', content: userMessage });
        conversation.history.push({ role: 'assistant', content: reply });

        if (conversation.history.length > 10) {
            conversation.history = conversation.history.slice(-10);
        }

        res.json({ reply });
    } catch (error) {
        console.error('Error al consultar DeepSeek API:', error);
        res.status(500).json({ reply: 'Lo siento, hubo un error al procesar tu mensaje. ¿Puedes intentarlo de nuevo?' });
    }
});

app.post('/reset/:id', validateChatbotId, (req, res) => {
    const chatbotId = req.params.id;
    conversations[chatbotId].context = null;
    conversations[chatbotId].history = [];
    res.json({ success: true });
});

async function generateDeepSeekResponse(message, knowledge, conversation) {
    const systemPrompt = `Eres un asistente útil que responde preguntas basándote únicamente en el siguiente conocimiento: ${knowledge}. 

    Instrucciones de formato:
    - Usa **negritas** para resaltar términos importantes.
    - Usa saltos de línea dobles para separar secciones.
    - Escribe URLs completas con https://.
    - Mantén un tono conversacional y breve.
    - Usa párrafos cortos.

    Instrucciones de comportamiento:
    - Responde saludos con "¡Hola! ¿En qué te puedo ayudar hoy?".
    - No generes contenido fuera del conocimiento proporcionado.
    - Si no sabes algo, di: "Lo siento, no tengo información sobre eso. ¿En qué más puedo ayudarte?"`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversation.history,
        { role: 'user', content: message }
    ];

    try {
        const completion = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: messages,
            temperature: 0.2,
            max_tokens: 200
        });

        return sanitizeHtml(completion.choices[0].message.content);
    } catch (error) {
        throw new Error('Error en la API de DeepSeek: ' + error.message);
    }
}

setInterval(() => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    Object.keys(chatbots).forEach(id => {
        if (now - chatbots[id].createdAt > ONE_HOUR) {
            delete chatbots[id];
            delete conversations[id];
        }
    });
}, 60 * 1000);

// Export the app for Vercel
module.exports = app;