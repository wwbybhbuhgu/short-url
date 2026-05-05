// ==================== 类型定义 ====================
export interface Env {
    DB: D1Database;
    KV: KVNamespace;
}

interface LinkRecord {
    slug: string;
    url: string;
    title: string | null;
    clicks: number;
    created_at: string;
}

// ==================== 工具函数 ====================
function generateRandomSlug(length: number = 6): string {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function updateKVCache(env: Env, slug: string, url: string): Promise<void> {
    await env.KV.put(slug, url, { expirationTtl: 86400 });
}

// ==================== 前端页面 HTML（无 emoji，简洁风格） ====================
function renderIndexPage(env: Env, requestUrl: URL): string {
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>短链接服务</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
            background: #f3f4f6;
            padding: 40px 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .card {
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 24px;
            overflow: hidden;
        }
        .card-header {
            padding: 24px 28px;
            border-bottom: 1px solid #e5e7eb;
            background: #fafafa;
        }
        .card-header h1 {
            font-size: 24px;
            font-weight: 600;
            color: #111827;
        }
        .card-header p {
            font-size: 14px;
            color: #6b7280;
            margin-top: 6px;
        }
        .card-body {
            padding: 28px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            color: #374151;
            margin-bottom: 6px;
        }
        input, textarea {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 14px;
            font-family: inherit;
            transition: border-color 0.15s, box-shadow 0.15s;
        }
        input:focus, textarea:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
        }
        textarea {
            resize: vertical;
            min-height: 90px;
        }
        .row {
            display: flex;
            gap: 20px;
        }
        .row .form-group {
            flex: 1;
        }
        button {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s;
            width: 100%;
        }
        button:hover {
            background: #2563eb;
        }
        .result {
            margin-top: 24px;
            padding: 16px;
            background: #f0f9ff;
            border-radius: 8px;
            display: none;
        }
        .result.show {
            display: block;
        }
        .short-url {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 12px;
        }
        .short-url input {
            flex: 1;
            background: white;
            font-family: monospace;
        }
        .copy-btn {
            background: #6b7280;
            width: auto;
            padding: 8px 16px;
        }
        .copy-btn:hover {
            background: #4b5563;
        }
        .error {
            color: #dc2626;
            font-size: 14px;
            margin-top: 10px;
        }
        .table-container {
            overflow-x: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        th, td {
            padding: 12px 12px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        th {
            background: #f9fafb;
            font-weight: 600;
            color: #111827;
        }
        .badge {
            background: #f3f4f6;
            padding: 4px 8px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 13px;
        }
        .click-count {
            font-weight: 600;
            color: #3b82f6;
        }
        .action-btn {
            background: none;
            border: none;
            color: #3b82f6;
            cursor: pointer;
            font-size: 13px;
            padding: 4px 8px;
            width: auto;
        }
        .action-btn:hover {
            text-decoration: underline;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #9ca3af;
        }
        @media (max-width: 768px) {
            .row { flex-direction: column; gap: 0; }
            .card-body { padding: 20px; }
        }
    </style>
</head>
<body>
<div class="container">
    <div class="card">
        <div class="card-header">
            <h1>短链接生成器</h1>
            <p>将长链接缩短为简洁易分享的短链接</p>
        </div>
        <div class="card-body">
            <div class="row">
                <div class="form-group">
                    <label>原始链接 *</label>
                    <textarea id="originalUrl" placeholder="https://example.com/very/long/url"></textarea>
                </div>
                <div class="form-group">
                    <label>自定义短码（可选）</label>
                    <input type="text" id="customSlug" placeholder="例如: mylink">
                    <small style="color:#6b7280;">留空则自动生成6位短码</small>
                </div>
            </div>
            <div class="form-group">
                <label>链接标题（可选）</label>
                <input type="text" id="title" placeholder="便于识别">
            </div>
            <button id="createBtn">生成短链接</button>
            <div id="result" class="result">
                <strong>创建成功</strong>
                <div class="short-url">
                    <input type="text" id="shortUrlInput" readonly>
                    <button id="copyBtn" class="copy-btn">复制</button>
                </div>
                <div id="errorMsg" class="error"></div>
            </div>
        </div>
    </div>

    <div class="card">
        <div class="card-header">
            <h2>我的链接</h2>
            <p>所有已创建的短链接及点击统计</p>
        </div>
        <div class="card-body">
            <div id="linksList" class="table-container">
                <div class="loading">加载中...</div>
            </div>
        </div>
    </div>
</div>

<script>
    const baseUrl = window.location.origin;
    const createBtn = document.getElementById('createBtn');
    const resultDiv = document.getElementById('result');
    const shortUrlInput = document.getElementById('shortUrlInput');
    const copyBtn = document.getElementById('copyBtn');
    const errorMsgDiv = document.getElementById('errorMsg');
    const linksListDiv = document.getElementById('linksList');

    async function loadLinks() {
        try {
            const resp = await fetch('/api/links');
            const data = await resp.json();
            if (data.success && data.links.length > 0) {
                renderLinksTable(data.links);
            } else {
                linksListDiv.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af;">暂无链接，创建第一个吧</div>';
            }
        } catch (err) {
            linksListDiv.innerHTML = '<div style="text-align:center;padding:20px;color:#dc2626;">加载失败，请刷新</div>';
        }
    }

    function renderLinksTable(links) {
        let html = '<table><thead><tr><th>短码</th><th>原始链接</th><th>标题</th><th>点击次数</th><th>创建时间</th><th>操作</th></tr></thead><tbody>';
        for (const link of links) {
            const shortUrl = baseUrl + '/' + link.slug;
            const displayUrl = link.url.length > 50 ? link.url.substring(0, 50) + '...' : link.url;
            const date = new Date(link.created_at).toLocaleString();
            html += '<tr>' +
                '<td><span class="badge">' + escapeHtml(link.slug) + '</span></td>' +
                '<td title="' + escapeHtml(link.url) + '">' + escapeHtml(displayUrl) + '</td>' +
                '<td>' + (link.title ? escapeHtml(link.title) : '-') + '</td>' +
                '<td class="click-count">' + link.clicks + '</td>' +
                '<td>' + date + '</td>' +
                '<td><button class="action-btn" onclick="copyToClipboard(\'' + shortUrl + '\')">复制链接</button></td>' +
                '</tr>';
        }
        html += '</tbody></table>';
        linksListDiv.innerHTML = html;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    window.copyToClipboard = function(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert('已复制: ' + text);
        });
    };

    copyBtn.addEventListener('click', () => {
        shortUrlInput.select();
        navigator.clipboard.writeText(shortUrlInput.value);
        alert('短链接已复制');
    });

    createBtn.addEventListener('click', async () => {
        const url = document.getElementById('originalUrl').value.trim();
        const slug = document.getElementById('customSlug').value.trim();
        const title = document.getElementById('title').value.trim();

        if (!url) {
            errorMsgDiv.innerText = '请填写原始链接';
            resultDiv.classList.add('show');
            return;
        }
        try {
            new URL(url);
        } catch(e) {
            errorMsgDiv.innerText = '请输入有效的URL（包含 http:// 或 https://）';
            resultDiv.classList.add('show');
            return;
        }

        createBtn.disabled = true;
        createBtn.innerText = '创建中...';
        errorMsgDiv.innerText = '';

        try {
            const resp = await fetch('/api/links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, slug: slug || undefined, title: title || undefined })
            });
            const data = await resp.json();
            if (resp.ok && data.success) {
                shortUrlInput.value = data.short_url;
                resultDiv.classList.add('show');
                errorMsgDiv.innerText = '';
                document.getElementById('originalUrl').value = '';
                document.getElementById('customSlug').value = '';
                document.getElementById('title').value = '';
                loadLinks();
            } else {
                errorMsgDiv.innerText = data.error || '创建失败';
                resultDiv.classList.add('show');
            }
        } catch (err) {
            errorMsgDiv.innerText = '网络错误，请稍后重试';
            resultDiv.classList.add('show');
        } finally {
            createBtn.disabled = false;
            createBtn.innerText = '生成短链接';
        }
    });

    loadLinks();
</script>
</body>
</html>`;
}

// ==================== 中间页 HTML（无 emoji，简洁风格） ====================
function renderRedirectPage(slug: string, originalUrl: string, title?: string): string {
    const pageTitle = title ? `${title} - 链接跳转` : '短链接跳转';
    const displayUrl = originalUrl.length > 60 ? originalUrl.substring(0, 60) + '...' : originalUrl;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(pageTitle)}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
            background: #f3f4f6;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 560px;
            width: 100%;
            padding: 32px;
            text-align: center;
        }
        h1 {
            font-size: 24px;
            font-weight: 600;
            color: #111827;
            margin-bottom: 8px;
        }
        .url-preview {
            background: #f9fafb;
            padding: 12px;
            border-radius: 8px;
            margin: 20px 0;
            word-break: break-all;
            color: #4b5563;
            font-size: 14px;
            border: 1px solid #e5e7eb;
        }
        .warning {
            background: #fef3c7;
            border-left: 3px solid #f59e0b;
            padding: 12px;
            margin: 20px 0;
            text-align: left;
            font-size: 13px;
            color: #92400e;
            border-radius: 6px;
        }
        .btn {
            background: #3b82f6;
            color: white;
            padding: 10px 24px;
            border-radius: 8px;
            font-weight: 500;
            border: none;
            cursor: pointer;
            font-size: 14px;
            width: 100%;
            transition: background 0.15s;
        }
        .btn:hover {
            background: #2563eb;
        }
        .footer {
            margin-top: 24px;
            font-size: 12px;
            color: #9ca3af;
        }
        .countdown {
            font-size: 13px;
            color: #6b7280;
            margin-top: 12px;
        }
    </style>
</head>
<body>
<div class="card">
    <h1>正在跳转</h1>
    <p style="color: #6b7280; font-size: 14px;">您即将访问以下链接</p>
    <div class="url-preview">${escapeHtml(displayUrl)}</div>
    <div class="warning">请核对链接地址，谨防钓鱼网站。</div>
    <button class="btn" id="redirectBtn">确认跳转</button>
    <div class="countdown" id="countdown">3 秒后自动跳转...</div>
    <div class="footer">短链接服务 · 安全提醒</div>
</div>
<script>
    let countdown = 3;
    const countdownEl = document.getElementById('countdown');
    const btn = document.getElementById('redirectBtn');
    const targetUrl = ${JSON.stringify(originalUrl)};
    const slug = ${JSON.stringify(slug)};

    function redirect() {
        fetch('/api/click/' + slug, { method: 'POST', keepalive: true }).catch(() => {});
        window.location.href = targetUrl;
    }

    btn.addEventListener('click', redirect);
    const timer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
            clearInterval(timer);
            redirect();
        } else {
            countdownEl.textContent = countdown + ' 秒后自动跳转...';
        }
    }, 1000);
</script>
</body>
</html>`;
}

// ==================== API 处理函数 ====================
async function handleCreateLink(request: Request, env: Env): Promise<Response> {
    try {
        const body = await request.json() as { url: string; slug?: string; title?: string };
        let { url, slug, title } = body;

        if (!url) {
            return Response.json({ error: 'url 参数是必需的' }, { status: 400 });
        }
        try {
            new URL(url);
        } catch {
            return Response.json({ error: '无效的 URL 格式' }, { status: 400 });
        }

        let isCustom = true;
        if (!slug) {
            slug = generateRandomSlug();
            isCustom = false;
        }
        if (!/^[a-zA-Z0-9]+$/.test(slug)) {
            return Response.json({ error: '短码只能包含字母和数字' }, { status: 400 });
        }

        const existing = await env.DB.prepare('SELECT slug FROM links WHERE slug = ?').bind(slug).first();
        if (existing) {
            if (isCustom) {
                return Response.json({ error: '该短码已被使用，请换一个' }, { status: 409 });
            } else {
                return Response.json({ error: '生成短码时发生碰撞，请重试' }, { status: 409 });
            }
        }

        await env.DB.prepare(
            'INSERT INTO links (slug, url, title, created_at) VALUES (?, ?, ?, datetime("now"))'
        ).bind(slug, url, title || null).run();

        await updateKVCache(env, slug, url);

        const requestUrl = new URL(request.url);
        const shortUrl = `${requestUrl.protocol}//${requestUrl.host}/${slug}`;

        return Response.json({
            success: true,
            slug,
            short_url: shortUrl,
            original_url: url
        }, { status: 201 });
    } catch (error) {
        console.error('创建链接失败:', error);
        return Response.json({ error: '服务器内部错误' }, { status: 500 });
    }
}

async function handleListLinks(env: Env): Promise<Response> {
    try {
        const { results } = await env.DB.prepare(
            'SELECT slug, url, title, clicks, created_at FROM links ORDER BY created_at DESC LIMIT 100'
        ).all();
        return Response.json({ success: true, links: results });
    } catch (error) {
        console.error('查询列表失败:', error);
        return Response.json({ error: '查询失败' }, { status: 500 });
    }
}

async function handleRecordClick(request: Request, env: Env, slug: string): Promise<Response> {
    const ctx = (request as any).ctx;
    const updatePromise = env.DB.prepare(
        'UPDATE links SET clicks = clicks + 1, updated_at = datetime("now") WHERE slug = ?'
    ).bind(slug).run();
    if (ctx && ctx.waitUntil) {
        ctx.waitUntil(updatePromise);
    } else {
        await updatePromise;
    }
    return Response.json({ success: true });
}

async function handleRedirectPageRoute(request: Request, env: Env, slug: string): Promise<Response> {
    let originalUrl = await env.KV.get(slug);
    let linkInfo: { url: string; title: string | null } | null = null;

    if (originalUrl) {
        const info = await env.DB.prepare('SELECT url, title FROM links WHERE slug = ?').bind(slug).first<{ url: string; title: string | null }>();
        if (info) linkInfo = info;
        else return new Response('链接不存在或已失效', { status: 404 });
    } else {
        const result = await env.DB.prepare('SELECT url, title FROM links WHERE slug = ?').bind(slug).first<{ url: string; title: string | null }>();
        if (!result) return new Response('404 - 短链接不存在', { status: 404 });
        linkInfo = result;
        originalUrl = result.url;
        await updateKVCache(env, slug, originalUrl);
    }

    return new Response(renderRedirectPage(slug, originalUrl, linkInfo.title || undefined), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
}

// ==================== 主入口 ====================
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        (request as any).ctx = ctx;

        if (path === '/api/links' && request.method === 'POST') {
            return handleCreateLink(request, env);
        }
        if (path === '/api/links' && request.method === 'GET') {
            return handleListLinks(env);
        }
        if (path.startsWith('/api/click/') && request.method === 'POST') {
            const slug = path.substring('/api/click/'.length);
            if (!slug) return new Response('Missing slug', { status: 400 });
            return handleRecordClick(request, env, slug);
        }
        if (path === '/' && request.method === 'GET') {
            return new Response(renderIndexPage(env, url), {
                headers: { 'Content-Type': 'text/html;charset=UTF-8' }
            });
        }
        if (request.method === 'GET' && path !== '/' && !path.startsWith('/api/')) {
            const slug = path.substring(1);
            if (slug) {
                return handleRedirectPageRoute(request, env, slug);
            }
        }
        return new Response('Not Found', { status: 404 });
    }
} satisfies ExportedHandler<Env>;
