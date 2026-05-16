// ==================== 类型定义 ====================
export interface Env {
    DB: D1Database;
    'KV-1': KVNamespace;   // 绑定名称必须与 Dashboard 中的变量名一致：KV-1
    AI: any;               // Cloudflare Workers AI binding
}

interface LinkRecord {
    slug: string;
    url: string;
    title: string | null;
    clicks: number;
    created_at: string;
    domain?: string | null;
    page_title?: string | null;
    moderation_status?: string | null;
    moderation_result?: string | null;
    is_blocked?: number;
}

interface ModerationResult {
    isSafe: boolean;
    safetyLevel: 'safe' | 'caution' | 'unsafe'; // 安全等级：安全/需谨慎/不安全
    categories: string[];
    confidence: number;
    reason?: string;
    details?: string; // 详细说明
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

// 提取域名
function extractDomain(url: string): string | null {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return null;
    }
}

// 获取页面内容
async function fetchPageContent(url: string): Promise<{ title: string | null; content: string | null }> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ShortURLBot/1.0)'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return { title: null, content: null };
        }

        const html = await response.text();

        // 提取 title
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : null;

        // 提取文本内容（去除 HTML 标签）
        const textContent = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // 只取前 5000 字符用于审核
        const content = textContent.substring(0, 5000);

        return { title, content: content || null };
    } catch (error) {
        console.error('获取页面内容失败:', error);
        return { title: null, content: null };
    }
}

// AI 内容审核 - 使用 LLM 进行智能分析
async function moderateContent(ai: any, content: string): Promise<ModerationResult> {
    try {
        // 构建提示词,要求 LLM 返回结构化数据
        const prompt = `请分析以下网页内容的安全性,并以 JSON 格式返回审核结果。

审核标准:
1. 安全等级(safetyLevel): "safe"(完全安全), "caution"(需谨慎,如包含广告、推广等), "unsafe"(不安全,如色情、暴力、诈骗等)
2. 分类(categories): 从以下选择: ["clean", "advertisement", "promotion", "adult", "violence", "gambling", "scam", "malware", "hate_speech", "spam"]
3. 是否安全(isSafe): safetyLevel 为 "safe" 或 "caution" 时为 true, "unsafe" 时为 false
4. 置信度(confidence): 0-1 之间的数字
5. 理由(reason): 简短说明审核结论
6. 详情(details): 详细说明发现的问题(如果有)

待审核内容(前500字符):
${content.substring(0, 500)}

请只返回 JSON 格式,不要其他文字。示例:
{
  "safetyLevel": "safe",
  "isSafe": true,
  "categories": ["clean"],
  "confidence": 0.95,
  "reason": "内容健康,无违规信息",
  "details": "页面内容为正常的技术文章"
}`;

        // 调用 LLM (使用 Qwen 模型)
        const response = await ai.run('@cf/qwen/qwen1.5-7b-chat-awq', {
            messages: [
                { role: 'system', content: '你是一个内容安全审核专家,负责评估网页内容的安全性。' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 300,
            temperature: 0.1
        });

        // 解析 LLM 返回的 JSON
        let result: ModerationResult;
        try {
            // 提取 JSON (LLM 可能返回额外的文字)
            const jsonMatch = response.response?.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                result = {
                    isSafe: parsed.isSafe ?? true,
                    safetyLevel: parsed.safetyLevel || 'safe',
                    categories: parsed.categories || ['clean'],
                    confidence: parsed.confidence || 0.8,
                    reason: parsed.reason || '审核完成',
                    details: parsed.details || ''
                };
            } else {
                throw new Error('无法解析 JSON');
            }
        } catch (parseError) {
            console.warn('LLM 返回解析失败,使用默认结果:', parseError);
            // 解析失败时,默认为需人工审核
            result = {
                isSafe: true,
                safetyLevel: 'caution',
                categories: ['unknown'],
                confidence: 0.5,
                reason: 'AI 审核结果解析失败,已标记为需人工审核',
                details: '原始响应: ' + (response.response?.substring(0, 200) || 'empty')
            };
        }

        return result;
    } catch (error) {
        console.error('AI 审核服务调用失败:', error);
        // 服务不可用时,不拦截但记录状态
        return {
            isSafe: true,
            safetyLevel: 'caution',
            categories: ['service_unavailable'],
            confidence: 0,
            reason: '审核服务暂时不可用',
            details: '请稍后重新审核或联系管理员'
        };
    }
}

// 执行内容审核并更新数据库
async function performContentModeration(env: Env, slug: string, url: string): Promise<void> {
    try {
        // 1. 提取域名
        const domain = extractDomain(url);

        // 2. 获取页面内容
        const { title, content } = await fetchPageContent(url);

        // 3. AI 审核
        let moderationResult: ModerationResult;
        if (content) {
            moderationResult = await moderateContent(env.AI, content);
        } else {
            moderationResult = {
                isSafe: true,
                categories: [],
                confidence: 0,
                reason: '无法获取页面内容，跳过审核'
            };
        }

        // 4. 更新数据库
        await env.DB.prepare(`
            UPDATE links 
            SET domain = ?, 
                page_title = ?, 
                moderation_status = ?, 
                moderation_result = ?, 
                moderated_at = datetime("now"),
                is_blocked = ?
            WHERE slug = ?
        `).bind(
            domain,
            title,
            moderationResult.isSafe ? 'approved' : 'rejected',
            JSON.stringify(moderationResult),
            moderationResult.isSafe ? 0 : 1,
            slug
        ).run();

        console.log(`内容审核完成 [${slug}]:`, moderationResult);
    } catch (error) {
        console.error('内容审核流程失败:', error);
        // 即使审核失败，也标记为已审核（但不拦截）
        await env.DB.prepare(`
            UPDATE links 
            SET moderation_status = 'error', 
                moderation_result = ?, 
                moderated_at = datetime("now")
            WHERE slug = ?
        `).bind(
            JSON.stringify({ error: String(error) }),
            slug
        ).run();
    }
}

async function updateKVCache(env: Env, slug: string, url: string): Promise<void> {
    await env['KV-1'].put(slug, url, { expirationTtl: 86400 });
}

// ==================== 前端页面 HTML（简洁风格，无 emoji） ====================
function renderIndexPage(env: Env, requestUrl: URL): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>短链接服务</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: #f3f4f6; padding: 40px 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .card { background: #ffffff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px; overflow: hidden; }
        .card-header { padding: 24px 28px; border-bottom: 1px solid #e5e7eb; background: #fafafa; }
        .card-header h1 { font-size: 24px; font-weight: 600; color: #111827; }
        .card-header p { font-size: 14px; color: #6b7280; margin-top: 6px; }
        .card-body { padding: 28px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px; }
        input, textarea { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s; }
        input:focus, textarea:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
        textarea { resize: vertical; min-height: 90px; }
        .row { display: flex; gap: 20px; }
        .row .form-group { flex: 1; }
        button { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.15s; width: 100%; }
        button:hover { background: #2563eb; }
        .result { margin-top: 24px; padding: 16px; background: #f0f9ff; border-radius: 8px; display: none; }
        .result.show { display: block; }
        .short-url { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
        .short-url input { flex: 1; background: white; font-family: monospace; }
        .copy-btn { background: #6b7280; width: auto; padding: 8px 16px; }
        .copy-btn:hover { background: #4b5563; }
        .error { color: #dc2626; font-size: 14px; margin-top: 10px; }
        .table-container { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th, td { padding: 12px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { background: #f9fafb; font-weight: 600; color: #111827; }
        .badge { background: #f3f4f6; padding: 4px 8px; border-radius: 6px; font-family: monospace; font-size: 13px; }
        .click-count { font-weight: 600; color: #3b82f6; }
        .action-btn { background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 13px; padding: 4px 8px; width: auto; }
        .action-btn:hover { text-decoration: underline; }
        .loading { text-align: center; padding: 40px; color: #9ca3af; }
        @media (max-width: 768px) { .row { flex-direction: column; gap: 0; } .card-body { padding: 20px; } }
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
    (function() {
        // DOM 元素
        const baseUrl = window.location.origin;
        const createBtn = document.getElementById('createBtn');
        const resultDiv = document.getElementById('result');
        const shortUrlInput = document.getElementById('shortUrlInput');
        const copyBtn = document.getElementById('copyBtn');
        const errorMsgDiv = document.getElementById('errorMsg');
        const linksListDiv = document.getElementById('linksList');

        // 公用转义函数
        const escapeHtml = (str) => {
            if (!str) return '';
            return str.replace(/[&<>]/g, (m) => {
                if (m === '&') return '&amp;';
                if (m === '<') return '&lt;';
                if (m === '>') return '&gt;';
                return m;
            });
        };

        // 复制功能（全局供事件委托调用）
        window.copyShortUrl = function(url) {
            navigator.clipboard.writeText(url).then(() => {
                alert('已复制: ' + url);
            }).catch(() => {
                alert('复制失败，请手动复制');
            });
        };

        // 渲染链接表格（不使用 onclick 属性，改用 data 属性 + 事件委托）
        function renderLinksTable(links) {
            if (!linksListDiv) return;
            if (!links || links.length === 0) {
                linksListDiv.innerHTML = '<div class="loading">暂无链接，创建第一个吧</div>';
                return;
            }
            let html = '<table><thead><tr><th>短码</th><th>原始链接</th><th>标题</th><th>域名</th><th>审核状态</th><th>点击次数</th><th>创建时间</th><th>操作</th></tr></thead><tbody>';
            for (const link of links) {
                const shortUrl = baseUrl + '/' + link.slug;
                const displayUrl = link.url.length > 50 ? link.url.substring(0, 50) + '...' : link.url;
                const date = new Date(link.created_at).toLocaleString();
                const safeSlug = escapeHtml(link.slug);
                const safeUrl = escapeHtml(link.url);
                const safeDisplayUrl = escapeHtml(displayUrl);
                const safeTitle = link.title ? escapeHtml(link.title) : '-';
                const safeDomain = link.domain ? escapeHtml(link.domain) : '-';
                
                // 审核状态徽章 - 显示安全等级
                let moderationBadge = '';
                if (link.moderation_status === 'pending') {
                    moderationBadge = '<span style="background:#fef3c7;color:#92400e;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;">⏳ 审核中</span>';
                } else if (link.moderation_result) {
                    try {
                        const result = JSON.parse(link.moderation_result);
                        const level = result.safetyLevel || 'safe';
                        const confidence = result.confidence ? Math.round(result.confidence * 100) : 0;
                        
                        if (level === 'safe') {
                            moderationBadge = `<span style="background:#d1fae5;color:#065f46;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;" title="${escapeHtml(result.reason || '')}">✓ 安全 ${confidence}%</span>`;
                        } else if (level === 'caution') {
                            moderationBadge = `<span style="background:#fef3c7;color:#92400e;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;" title="${escapeHtml(result.reason || '')}">⚠ 需谨慎 ${confidence}%</span>`;
                        } else if (level === 'unsafe') {
                            moderationBadge = `<span style="background:#fee2e2;color:#991b1b;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;" title="${escapeHtml(result.reason || '')}">✗ 不安全 ${confidence}%</span>`;
                        } else {
                            moderationBadge = '<span style="background:#f3f4f6;color:#6b7280;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;">待审核</span>';
                        }
                    } catch (e) {
                        moderationBadge = '<span style="color:#9ca3af;font-size:12px;">已审核</span>';
                    }
                } else if (link.moderation_status === 'error') {
                    moderationBadge = '<span style="background:#f3f4f6;color:#6b7280;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;">审核失败</span>';
                } else {
                    moderationBadge = '<span style="color:#9ca3af;font-size:12px;">未审核</span>';
                }
                
                html += '<tr>' +
                    '<td><span class="badge">' + safeSlug + '</span></td>' +
                    '<td title="' + safeUrl + '">' + safeDisplayUrl + '</td>' +
                    '<td>' + safeTitle + '</td>' +
                    '<td>' + safeDomain + '</td>' +
                    '<td>' + moderationBadge + '</td>' +
                    '<td class="click-count">' + link.clicks + '</td>' +
                    '<td>' + date + '</td>' +
                    '<td><button class="action-btn copy-link-btn" data-url="' + shortUrl.replace(/"/g, '&quot;') + '">复制链接</button></td>' +
                '</tr>';
            }
            html += '</tbody></table>';
            linksListDiv.innerHTML = html;
        }

        // 加载链接列表
        async function loadLinks() {
            try {
                const resp = await fetch('/api/links');
                const data = await resp.json();
                if (data.success && data.links && data.links.length > 0) {
                    renderLinksTable(data.links);
                } else {
                    if (linksListDiv) linksListDiv.innerHTML = '<div class="loading">暂无链接，创建第一个吧</div>';
                }
            } catch (err) {
                console.error('加载链接列表失败:', err);
                if (linksListDiv) linksListDiv.innerHTML = '<div class="loading" style="color:#dc2626;">加载失败，请刷新</div>';
            }
        }

        // 事件委托：处理表格中的复制按钮点击
        if (linksListDiv) {
            linksListDiv.addEventListener('click', (e) => {
                const btn = e.target.closest('.copy-link-btn');
                if (btn && btn.dataset.url) {
                    copyShortUrl(btn.dataset.url);
                }
            });
        }

        // 创建短链接
        async function handleCreate() {
            const urlInput = document.getElementById('originalUrl');
            const slugInput = document.getElementById('customSlug');
            const titleInput = document.getElementById('title');
            const url = urlInput ? urlInput.value.trim() : '';
            const slug = slugInput ? slugInput.value.trim() : '';
            const title = titleInput ? titleInput.value.trim() : '';

            if (!url) {
                if (errorMsgDiv) errorMsgDiv.innerText = '请填写原始链接';
                if (resultDiv) resultDiv.classList.add('show');
                return;
            }
            try {
                new URL(url);
            } catch(e) {
                if (errorMsgDiv) errorMsgDiv.innerText = '请输入有效的URL（包含 http:// 或 https://）';
                if (resultDiv) resultDiv.classList.add('show');
                return;
            }

            if (createBtn) {
                createBtn.disabled = true;
                createBtn.innerText = '创建中...';
            }
            if (errorMsgDiv) errorMsgDiv.innerText = '';

            try {
                const resp = await fetch('/api/links', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, slug: slug || undefined, title: title || undefined })
                });
                const data = await resp.json();
                if (resp.ok && data.success) {
                    if (shortUrlInput) shortUrlInput.value = data.short_url;
                    if (resultDiv) resultDiv.classList.add('show');
                    if (errorMsgDiv) errorMsgDiv.innerText = '';
                    if (urlInput) urlInput.value = '';
                    if (slugInput) slugInput.value = '';
                    if (titleInput) titleInput.value = '';
                    loadLinks(); // 刷新列表
                } else {
                    if (errorMsgDiv) errorMsgDiv.innerText = data.error || '创建失败';
                    if (resultDiv) resultDiv.classList.add('show');
                }
            } catch (err) {
                console.error('创建请求失败:', err);
                if (errorMsgDiv) errorMsgDiv.innerText = '网络错误，请稍后重试';
                if (resultDiv) resultDiv.classList.add('show');
            } finally {
                if (createBtn) {
                    createBtn.disabled = false;
                    createBtn.innerText = '生成短链接';
                }
            }
        }

        // 复制短链接（独立复制按钮）
        if (copyBtn && shortUrlInput) {
            copyBtn.addEventListener('click', () => {
                shortUrlInput.select();
                copyShortUrl(shortUrlInput.value);
            });
        }

        // 绑定生成按钮事件
        if (createBtn) {
            createBtn.addEventListener('click', handleCreate);
        } else {
            console.error('未找到 createBtn');
        }

        // 启动
        loadLinks();
    })();
</script>
</body>
</html>`;
}
// ==================== 中间页 HTML ====================
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
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
        h1 { font-size: 24px; font-weight: 600; color: #111827; margin-bottom: 8px; }
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
            margin-top: 12px;
        }
        .btn:hover { background: #2563eb; }
        .btn-secondary {
            background: #6b7280;
        }
        .btn-secondary:hover { background: #4b5563; }
        .footer { margin-top: 24px; font-size: 12px; color: #9ca3af; }
        .info-text { font-size: 14px; color: #6b7280; margin-top: 12px; }
        .title-display {
            background: #ecfdf5;
            border: 1px solid #10b981;
            padding: 12px;
            border-radius: 8px;
            margin: 16px 0;
            text-align: left;
            font-size: 14px;
            color: #065f46;
        }
        .title-loading { color: #9ca3af; font-style: italic; }
        .title-error { color: #dc2626; font-size: 13px; margin-top: 8px; }
    </style>
</head>
<body>
<div class="card">
    <h1>链接跳转</h1>
    <p style="color: #6b7280; font-size: 14px;">您即将访问以下链接</p>
    <div class="url-preview">${escapeHtml(displayUrl)}</div>
    <div class="warning">请核对链接地址，谨防钓鱼网站。</div>
    <div id="titleSection"></div>
    <button class="btn btn-secondary" id="fetchTitleBtn">获取目标标题</button>
    <button class="btn" id="redirectBtn">确认跳转</button>
    <p class="info-text">点击按钮后将跳转到目标网站</p>
    <div class="footer">短链接服务 · 安全提醒</div>
</div>
<script>
    const btn = document.getElementById('redirectBtn');
    const fetchTitleBtn = document.getElementById('fetchTitleBtn');
    const titleSection = document.getElementById('titleSection');
    const targetUrl = ${JSON.stringify(originalUrl)};
    const slug = ${JSON.stringify(slug)};

    // 手动跳转
    btn.addEventListener('click', () => {
        fetch('/api/click/' + slug, { method: 'POST', keepalive: true }).catch(() => {});
        window.location.href = targetUrl;
    });

    // 获取目标标题（用户主动触发）
    fetchTitleBtn.addEventListener('click', async () => {
        fetchTitleBtn.disabled = true;
        fetchTitleBtn.textContent = '获取中...';
        titleSection.innerHTML = '<p class="title-loading">正在获取标题...</p>';

        try {
            const resp = await fetch('/api/title/' + slug);
            const data = await resp.json();

            if (data.success && data.title) {
                titleSection.innerHTML = '<div class="title-display"><strong>目标标题：</strong>' + escapeHtml(data.title) + '</div>';
            } else if (data.success && !data.title) {
                titleSection.innerHTML = '<p class="title-error">未能获取到页面标题</p>';
            } else {
                titleSection.innerHTML = '<p class="title-error">获取失败：' + escapeHtml(data.error || '未知错误') + '</p>';
            }
        } catch (err) {
            titleSection.innerHTML = '<p class="title-error">网络错误，请稍后重试</p>';
        } finally {
            fetchTitleBtn.disabled = false;
            fetchTitleBtn.textContent = '获取目标标题';
        }
    });

    // HTML 转义函数
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
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
            'INSERT INTO links (slug, url, title, created_at, moderation_status) VALUES (?, ?, ?, datetime("now"), "pending")'
        ).bind(slug, url, title || null).run();

        await updateKVCache(env, slug, url);

        // 异步执行内容审核（不阻塞响应）
        const ctx = (request as any).ctx;
        if (ctx && ctx.waitUntil) {
            ctx.waitUntil(performContentModeration(env, slug, url));
        } else {
            // 如果没有 waitUntil，仍然执行但不等待
            performContentModeration(env, slug, url).catch(err => {
                console.error('后台审核失败:', err);
            });
        }

        const requestUrl = new URL(request.url);
        const shortUrl = `${requestUrl.protocol}//${requestUrl.host}/${slug}`;

        return Response.json({
            success: true,
            slug,
            short_url: shortUrl,
            original_url: url,
            moderation_status: 'pending'
        }, { status: 201 });
    } catch (error) {
        console.error('创建链接失败:', error);
        return Response.json({ error: '服务器内部错误' }, { status: 500 });
    }
}

async function handleListLinks(env: Env): Promise<Response> {
    try {
        const { results } = await env.DB.prepare(
            'SELECT slug, url, title, clicks, created_at, domain, page_title, moderation_status, moderation_result, is_blocked FROM links ORDER BY created_at DESC LIMIT 100'
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

async function handleGetTitle(env: Env, slug: string): Promise<Response> {
    try {
        // 从数据库获取目标 URL
        const result = await env.DB.prepare('SELECT url FROM links WHERE slug = ?').bind(slug).first<{ url: string }>();
        if (!result) {
            return Response.json({ error: '链接不存在' }, { status: 404 });
        }

        const targetUrl = result.url;

        // 使用 fetch 获取目标页面标题（带超时和错误处理）
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

            const response = await fetch(targetUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ShortURLBot/1.0)'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return Response.json({ success: true, title: null, message: '无法访问目标页面' });
            }

            const html = await response.text();

            // 提取 title 标签内容
            const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : null;

            return Response.json({ success: true, title });
        } catch (fetchError: any) {
            console.error('获取标题失败:', fetchError);
            return Response.json({
                success: true,
                title: null,
                error: fetchError.name === 'AbortError' ? '请求超时' : '无法获取页面内容'
            });
        }
    } catch (error) {
        console.error('获取标题API错误:', error);
        return Response.json({ error: '服务器内部错误' }, { status: 500 });
    }
}

async function handleGetModerationStatus(env: Env, slug: string): Promise<Response> {
    try {
        const result = await env.DB.prepare(
            'SELECT slug, url, domain, page_title, moderation_status, moderation_result, is_blocked, moderated_at FROM links WHERE slug = ?'
        ).bind(slug).first();

        if (!result) {
            return Response.json({ error: '链接不存在' }, { status: 404 });
        }

        return Response.json({ success: true, data: result });
    } catch (error) {
        console.error('查询审核状态失败:', error);
        return Response.json({ error: '查询失败' }, { status: 500 });
    }
}

async function handleRetryModeration(request: Request, env: Env, slug: string): Promise<Response> {
    try {
        // 检查链接是否存在
        const link = await env.DB.prepare('SELECT url FROM links WHERE slug = ?').bind(slug).first<{ url: string }>();
        if (!link) {
            return Response.json({ error: '链接不存在' }, { status: 404 });
        }

        // 重置审核状态
        await env.DB.prepare(`
            UPDATE links 
            SET moderation_status = 'pending', 
                moderation_result = NULL, 
                is_blocked = 0, 
                moderated_at = NULL 
            WHERE slug = ?
        `).bind(slug).run();

        // 异步重新审核
        const ctx = (request as any).ctx;
        if (ctx && ctx.waitUntil) {
            ctx.waitUntil(performContentModeration(env, slug, link.url));
        } else {
            performContentModeration(env, slug, link.url).catch(err => {
                console.error('重新审核失败:', err);
            });
        }

        return Response.json({ success: true, message: '已重新开始审核' });
    } catch (error) {
        console.error('重新审核失败:', error);
        return Response.json({ error: '服务器内部错误' }, { status: 500 });
    }
}

async function handleRedirectPageRoute(request: Request, env: Env, slug: string): Promise<Response> {
    // 拒绝格式无效的 slug（防止扫描器攻击）
    if (!/^[a-zA-Z0-9]+$/.test(slug)) {
        return new Response('Invalid short link', { status: 404 });
    }

    let originalUrl = await env['KV-1'].get(slug);
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
        if (path.startsWith('/api/title/') && request.method === 'GET') {
            const slug = path.substring('/api/title/'.length);
            if (!slug) return new Response('Missing slug', { status: 400 });
            return handleGetTitle(env, slug);
        }
        if (path.startsWith('/api/moderation/') && request.method === 'GET') {
            const slug = path.substring('/api/moderation/'.length);
            if (!slug) return new Response('Missing slug', { status: 400 });
            return handleGetModerationStatus(env, slug);
        }
        if (path.startsWith('/api/moderation/') && request.method === 'POST') {
            const slug = path.substring('/api/moderation/'.length);
            if (!slug) return new Response('Missing slug', { status: 400 });
            return handleRetryModeration(request, env, slug);
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
