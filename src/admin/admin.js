import { api, clearToken, download, fileToBase64, getToken, setToken } from '../ui/api.js';

const state = {
  user: null,
  view: 'dashboard',
  dashboard: null,
  knowledge: [],
  knowledgeGrade: 4,
  questions: { items: [], total: 0 },
  questionFilters: { status: '', type: '', search: '', grade: 4 },
  imports: [],
  preview: null,
  aiJobs: [],
  aiJob: null,
  audit: [],
  configs: [],
  users: [],
  busy: false,
  toastTimer: null,
  pollTimer: null,
};

const root = () => document.querySelector('#admin-root');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function toast(message) {
  const el = document.querySelector('#admin-toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

async function run(work) {
  if (state.busy) return;
  state.busy = true;
  try {
    await work();
  } catch (error) {
    if (error?.status === 401) {
      clearToken();
      state.user = null;
      renderLogin('登录已过期，请重新登录。');
      return;
    }
    toast(error?.message || '操作失败，请重试。');
  } finally {
    state.busy = false;
  }
}

function renderLogin(message = '') {
  document.querySelector('#admin-root').innerHTML = `
    <div class="admin-login">
      <div class="admin-login-card">
        <div class="admin-brand"><span class="admin-brand-mark">数</span><div><b>数境勇者</b><small>教研运营后台 · P0 MVP</small></div></div>
        <h1>教研管理员登录</h1>
        <p>${esc(message || '管理知识树、题库、导入批次和 AI 生成草稿。')}</p>
        <label class="field"><span>用户名</span><input id="admin-username" autocomplete="username" value="admin" /></label>
        <label class="field"><span>密码</span><input id="admin-password" type="password" autocomplete="current-password" value="admin1234" /></label>
        <button class="btn btn--primary btn--block" type="button" data-action="admin-login">登录后台</button>
        <p class="small muted" style="margin-top:14px">演示账号：admin / admin1234</p>
      </div>
    </div>`;
}

function shell(content) {
  const nav = [
    ['dashboard', '总览'],
    ['knowledge', '知识树'],
    ['questions', '题库管理'],
    ['imports', '导入中心'],
    ['ai', 'AI 生成中心'],
    ['users', '账号'],
    ['audit', '审计日志'],
    ['configs', '运营配置'],
  ];
  document.querySelector('#admin-root').innerHTML = `
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-brand"><span class="admin-brand-mark">数</span><div><b>数境勇者</b><small>教研运营后台</small></div></div>
        <nav class="admin-nav">${nav.map(([view, label]) => `<button type="button" class="${state.view === view ? 'is-active' : ''}" data-action="view" data-view="${view}">${label}${view === 'ai' && state.dashboard?.counts?.pendingAi ? `<small>${state.dashboard.counts.pendingAi}</small>` : ''}</button>`).join('')}</nav>
        <div class="admin-sidebar-foot"><p>${esc(state.user?.display_name || state.user?.displayName || '管理员')} · ${esc(state.user?.username || '')}</p><a class="btn btn--sm btn--block" href="/" target="_blank" rel="noreferrer">打开学生端</a><button class="btn btn--sm btn--block" type="button" data-action="admin-logout">退出登录</button></div>
      </aside>
      <main class="admin-main">${content}</main>
    </div>`;
  if (state.preview && state.view === 'imports') { /* preview rendered in view */ }
}

function top(title, subtitle, actions = '') {
  return `<div class="admin-top"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="admin-top-actions">${actions}</div></div>`;
}

/* Dashboard --------------------------------------------------------- */

function dashboardView() {
  const data = state.dashboard || { counts: {}, imports: [], aiJobs: [], auditLogs: [] };
  const counts = data.counts || {};
  return `${top('运营总览', '题库、学习、导入和 AI 任务的核心指标', '<button class="btn btn--sm" type="button" data-action="refresh">刷新</button>')}
    <div class="stat-grid">
      <div class="stat-card"><span>题目总数</span><b>${counts.questions ?? 0}</b></div>
      <div class="stat-card"><span>已发布</span><b>${counts.published ?? 0}</b></div>
      <div class="stat-card"><span>待审核题目</span><b>${counts.pendingQuestions ?? 0}</b></div>
      <div class="stat-card"><span>知识点</span><b>${counts.knowledgePoints ?? 0}</b></div>
      <div class="stat-card"><span>学生</span><b>${counts.students ?? 0}</b></div>
      <div class="stat-card"><span>答题记录</span><b>${counts.answers ?? 0}</b></div>
      <div class="stat-card"><span>待复习错题</span><b>${counts.mistakes ?? 0}</b></div>
      <div class="stat-card"><span>AI 草稿待审</span><b>${counts.pendingAi ?? 0}</b></div>
    </div>
    <div class="split">
      <div class="panel"><div class="panel-head"><h2>最近的导入批次</h2><button class="btn btn--sm" type="button" data-action="view" data-view="imports">导入中心</button></div>
        ${data.imports.length ? `<div class="table-wrap"><table><thead><tr><th>文件</th><th>状态</th><th>成功/失败</th><th>时间</th></tr></thead><tbody>${data.imports.map((row) => `<tr><td>${esc(row.filename)}</td><td>${statusBadge(row.status)}</td><td>${row.success} / ${row.failed}</td><td class="small">${formatTime(row.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="table-empty">暂无导入记录</p>'}
      </div>
      <div class="panel"><div class="panel-head"><h2>AI 生成任务</h2><button class="btn btn--sm" type="button" data-action="view" data-view="ai">生成中心</button></div>
        ${data.aiJobs.length ? `<div class="table-wrap"><table><thead><tr><th>知识点</th><th>题型</th><th>状态</th><th>时间</th></tr></thead><tbody>${data.aiJobs.map((row) => `<tr><td class="mono">${esc(row.knowledge_code)}</td><td>${esc(row.type)}</td><td>${statusBadge(row.status)}</td><td class="small">${formatTime(row.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="table-empty">暂无 AI 任务</p>'}
      </div>
    </div>
    <div class="panel"><div class="panel-head"><h2>最近审计日志</h2><button class="btn btn--sm" type="button" data-action="view" data-view="audit">查看全部</button></div>
      <div class="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>对象 ID</th></tr></thead><tbody>${(data.auditLogs || []).map((row) => `<tr><td class="small">${formatTime(row.created_at)}</td><td>${esc(row.display_name || row.actor_id || '-')}</td><td>${esc(row.action)}</td><td>${esc(row.object_type)}</td><td class="mono">${esc(row.object_id || '-')}</td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">暂无日志</td></tr>'}</tbody></table></div>
    </div>`;
}

/* Knowledge --------------------------------------------------------- */

function knowledgeView() {
  return `${top('知识树', '按年级、单元和知识点维护数学知识树', '<button class="btn btn--primary btn--sm" type="button" data-action="new-knowledge">新增知识点</button>')}
    <div class="tabs">${[1, 2, 3, 4, 5, 6].map((grade) => `<button class="tab ${state.knowledgeGrade === grade ? 'is-active' : ''}" type="button" data-action="knowledge-grade" data-grade="${grade}">${grade} 年级</button>`).join('')}</div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>编码</th><th>名称</th><th>单元</th><th>难度</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${state.knowledge.length ? state.knowledge.map((row) => `<tr><td class="mono">${esc(row.code)}</td><td><b>${esc(row.name.zh)}</b><div class="small muted">${esc(row.name.en)}</div></td><td>${esc(row.unitName.zh)}<div class="small muted">${esc(row.unitCode)}</div></td><td>${row.difficulty}</td><td>${row.status === 'active' ? '<span class="badge badge--green">启用</span>' : '<span class="badge badge--muted">停用</span>'}</td><td><button class="btn btn--sm" type="button" data-action="edit-knowledge" data-code="${esc(row.code)}">编辑</button></td></tr>`).join('') : '<tr><td colspan="6" class="table-empty">该年级暂无知识点</td></tr>'}
    </tbody></table></div></div>`;
}

/* Questions --------------------------------------------------------- */

function questionsView() {
  const filters = state.questionFilters;
  return `${top('题库管理', '题目版本、审核状态、媒体和知识点标签；学生端只读取已发布题目', '<button class="btn btn--primary btn--sm" type="button" data-action="new-question">新增题目</button>')}
    <div class="toolbar">
      <label class="field"><span>搜索</span><input id="filter-search" value="${esc(filters.search)}" placeholder="题干或编码" /></label>
      <label class="field"><span>状态</span><select id="filter-status"><option value="">全部</option>${['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED'].map((status) => `<option value="${status}" ${filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label>
      <label class="field"><span>题型</span><select id="filter-type"><option value="">全部</option>${['SINGLE', 'JUDGE', 'NUMBER', 'FRACTION', 'MULTI', 'TEXT'].map((type) => `<option value="${type}" ${filters.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
      <label class="field"><span>年级</span><select id="filter-grade">${[1, 2, 3, 4, 5, 6].map((grade) => `<option value="${grade}" ${filters.grade === grade ? 'selected' : ''}>${grade} 年级</option>`).join('')}</select></label>
      <button class="btn btn--sm" type="button" data-action="apply-question-filters">筛选</button>
    </div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>编码</th><th>题型</th><th>题干</th><th>知识点</th><th>状态</th><th>来源</th><th>曝光/正确率</th><th>操作</th></tr></thead><tbody>
      ${state.questions.items.length ? state.questions.items.map((row) => `<tr>
        <td class="mono">${esc(row.code)}</td>
        <td><span class="badge badge--violet">${esc(row.type)}</span></td>
        <td class="prewrap" style="max-width:330px">${esc(row.stem?.zh || '')}</td>
        <td class="small">${esc(row.knowledgeName?.zh || row.knowledgeCode)}<div class="muted mono">${esc(row.knowledgeCode)}</div></td>
        <td>${statusBadge(row.status)}</td>
        <td class="small">${esc(row.source)}</td>
        <td class="small">${row.stats?.exposures || 0} / ${row.stats?.accuracy ?? 0}%</td>
        <td><div style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn--sm" type="button" data-action="edit-question" data-id="${row.id}">编辑</button>${row.status === 'PUBLISHED' ? `<button class="btn btn--sm" type="button" data-action="question-status" data-id="${row.id}" data-status="unpublish">下架</button>` : `<button class="btn btn--sm" type="button" data-action="question-status" data-id="${row.id}" data-status="publish">发布</button>`}</div></td>
      </tr>`).join('') : '<tr><td colspan="8" class="table-empty">没有符合条件的题目</td></tr>'}
    </tbody></table></div><p class="small muted">共 ${state.questions.total} 条，显示 ${state.questions.items.length} 条</p></div>`;
}

/* Import ------------------------------------------------------------ */

function importsView() {
  const preview = state.preview;
  return `${top('导入中心', 'XLSX 多 Sheet 或 CSV 单表导入；有效行进入草稿，错误行不污染题库', '<button class="btn btn--sm" type="button" data-action="download-template" data-format="xlsx">下载 XLSX 模板</button><button class="btn btn--sm" type="button" data-action="download-template" data-format="csv">下载 CSV 模板</button>')}
    <div class="panel"><div class="panel-head"><h2>上传题库文件</h2></div>
      <p class="small muted">支持 .xlsx（knowledge_points / questions / question_options / question_answers 四个 Sheet）或 .csv（单表题目，选项列 option_a…option_d 可选）。单次最多 1000 行、8 MB。</p>
      <input id="import-file" type="file" accept=".xlsx,.csv" />
    </div>
    ${preview ? `<div class="panel"><div class="panel-head"><h2>校验预览 · ${esc(preview.filename)}</h2><div>${statusBadge(preview.status)}</div></div>
      <div class="stat-grid"><div class="stat-card"><span>有效题目</span><b>${preview.stats?.validQuestions || 0}</b></div><div class="stat-card"><span>有效知识点</span><b>${preview.stats?.validKnowledge || 0}</b></div><div class="stat-card"><span>错误行</span><b>${preview.failed || 0}</b></div><div class="stat-card"><span>警告</span><b>${preview.warnings?.length || 0}</b></div></div>
      ${preview.errors?.length ? `<h3 class="small">错误</h3><ul class="error-list">${preview.errors.slice(0, 30).map((item) => `<li>${esc(item.sheet)} 第 ${item.row} 行 · ${esc(item.field)}：${esc(item.message)}</li>`).join('')}</ul>` : ''}
      ${preview.warnings?.length ? `<h3 class="small">警告</h3><ul class="warning-list">${preview.warnings.slice(0, 15).map((item) => `<li>${esc(item.sheet)} 第 ${item.row} 行：${esc(item.message)}</li>`).join('')}</ul>` : ''}
      ${preview.sample?.questions?.length ? `<h3 class="small">有效题目示例</h3><div class="table-wrap"><table><thead><tr><th>编码</th><th>题型</th><th>题干</th></tr></thead><tbody>${preview.sample.questions.map((item) => `<tr><td class="mono">${esc(item.code)}</td><td>${esc(item.type)}</td><td>${esc(item.stem?.zh || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="admin-modal-actions">
        ${preview.status === 'VALIDATED' ? `<button class="btn btn--primary" type="button" data-action="import-commit" data-id="${preview.id}">确认入库（有效行）</button>` : ''}
        ${preview.status === 'COMPLETED' ? `<button class="btn btn--danger" type="button" data-action="import-rollback" data-id="${preview.id}">回滚该批次</button>` : ''}
      </div>
    </div>` : ''}
    <div class="panel"><div class="panel-head"><h2>导入批次</h2><button class="btn btn--sm" type="button" data-action="refresh">刷新</button></div><div class="table-wrap"><table><thead><tr><th>文件</th><th>状态</th><th>总数</th><th>成功</th><th>失败</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
      ${state.imports.length ? state.imports.map((row) => `<tr><td>${esc(row.filename)}</td><td>${statusBadge(row.status)}</td><td>${row.total}</td><td>${row.success}</td><td>${row.failed}</td><td class="small">${formatTime(row.created_at)}</td><td><button class="btn btn--sm" type="button" data-action="open-import" data-id="${row.id}">查看</button></td></tr>`).join('') : '<tr><td colspan="7" class="table-empty">暂无导入批次</td></tr>'}
    </tbody></table></div></div>`;
}

/* AI --------------------------------------------------------------- */

function aiView() {
  const knowledgeOptions = state.knowledge.map((row) => `<option value="${esc(row.code)}">${esc(row.name.zh)}（${esc(row.code)}）</option>`).join('') || '<option value="MATH-RJ-G4-T1-NUM-01">多位数乘法与因数 · 基础</option>';
  return `${top('AI 生成中心', '离线模板提供方生成数学题草稿；必须人工审核通过后才发布到学生端', '<button class="btn btn--sm" type="button" data-action="refresh">刷新</button>')}
    <div class="panel"><div class="panel-head"><h2>创建生成任务</h2></div>
      <div class="toolbar">
        <label class="field" style="min-width:280px"><span>知识点</span><select id="ai-knowledge">${knowledgeOptions}</select></label>
        <label class="field"><span>题型</span><select id="ai-type">${['SINGLE', 'NUMBER', 'FRACTION', 'JUDGE', 'MULTI', 'TEXT'].map((type) => `<option value="${type}">${type}</option>`).join('')}</select></label>
        <label class="field"><span>难度</span><select id="ai-difficulty">${[1, 2, 3, 4, 5].map((level) => `<option value="${level}" ${level === 2 ? 'selected' : ''}>${level}</option>`).join('')}</select></label>
        <label class="field"><span>数量</span><select id="ai-count">${[1, 2, 3, 4, 5].map((count) => `<option value="${count}">${count}</option>`).join('')}</select></label>
        <button class="btn btn--primary" type="button" data-action="create-ai-job">创建任务</button>
      </div>
      <p class="small muted">P0 演示使用本地数学模板提供方（local-template），不调用外部模型、不发送学生数据。接入真实模型时替换 provider 适配层即可。</p>
    </div>
    ${state.aiJob ? aiJobView(state.aiJob) : ''}
    <div class="panel"><div class="panel-head"><h2>生成任务</h2></div><div class="table-wrap"><table><thead><tr><th>知识点</th><th>题型</th><th>数量</th><th>状态</th><th>草稿</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
      ${state.aiJobs.length ? state.aiJobs.map((row) => `<tr><td class="mono">${esc(row.knowledge_code)}</td><td>${esc(row.type)}</td><td>${row.count}</td><td>${statusBadge(row.status)}</td><td>${row.pending_count || 0} / ${row.item_count || 0}</td><td class="small">${formatTime(row.created_at)}</td><td><button class="btn btn--sm" type="button" data-action="open-ai-job" data-id="${row.id}">查看</button></td></tr>`).join('') : '<tr><td colspan="7" class="table-empty">暂无任务</td></tr>'}
    </tbody></table></div></div>`;
}

function aiJobView(job) {
  return `<div class="panel"><div class="panel-head"><h2>任务 ${esc(job.id)}</h2><div>${statusBadge(job.status)} <span class="small muted">${esc(job.provider)} / ${esc(job.model)}</span></div></div>
    <p class="small muted">知识点 ${esc(job.knowledgeCode)} · 请求 ${esc(job.type)} · 难度 ${job.difficulty} · 数量 ${job.count} · tokens ${job.tokens} · 成本 ${job.costCents} 分</p>
    ${job.items.length ? job.items.map((item) => `<div class="ai-item"><div class="ai-item-head"><span class="badge ${item.status === 'APPROVED' ? 'badge--green' : item.status === 'REJECTED' ? 'badge--red' : 'badge--gold'}">${item.status}</span><span class="small muted">${esc(item.validation?.notes?.join(' · ') || '校验通过')}</span></div>
      <p><b>${esc(item.content?.stem?.zh || '')}</b></p><p class="small muted">${esc(item.content?.stem?.en || '')}</p>
      ${item.content?.options?.length ? `<p class="small">${item.content.options.map((option) => `${esc(option.key)}. ${esc(option.text?.zh)}`).join(' · ')}</p>` : ''}
      <p class="small">答案：<code>${esc(JSON.stringify(item.answer?.value))}</code> · 解析：${esc(item.content?.explanation?.zh || '')}</p>
      ${item.validation?.duplicate ? '<p class="small" style="color:var(--gold)">检测到相似题干，请人工确认。</p>' : ''}
      ${item.status === 'DRAFT' ? `<div class="ai-item-actions"><button class="btn btn--primary btn--sm" type="button" data-action="ai-approve" data-id="${item.id}">审核通过并发布</button><button class="btn btn--danger btn--sm" type="button" data-action="ai-reject" data-id="${item.id}">驳回</button></div>` : ''}
    </div>`).join('') : `<p class="table-empty">${job.status === 'SUCCEEDED' ? '任务没有生成可审核的草稿' : '任务处理中…'}</p>`}
  </div>`;
}

/* Audit / configs / users ------------------------------------------ */

function auditView() {
  return `${top('审计日志', '登录、题库、导入、AI 审核、家长绑定和配置变更', '<button class="btn btn--sm" type="button" data-action="refresh">刷新</button>')}
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>角色</th><th>动作</th><th>对象</th><th>对象 ID</th><th>IP</th></tr></thead><tbody>
      ${state.audit.length ? state.audit.map((row) => `<tr><td class="small">${formatTime(row.created_at)}</td><td>${esc(row.actor_name || row.actor_id || '-')}</td><td>${esc(row.actor_role || '-')}</td><td class="mono">${esc(row.action)}</td><td>${esc(row.object_type)}</td><td class="mono">${esc(row.object_id || '-')}</td><td class="small">${esc(row.ip || '-')}</td></tr>`).join('') : '<tr><td colspan="7" class="table-empty">暂无日志</td></tr>'}
    </tbody></table></div></div>`;
}

function configsView() {
  const config = (key) => state.configs.find((item) => item.key === key)?.value || {};
  const announcement = config('announcement');
  const flags = config('feature_flags');
  return `${top('运营配置', '公告、功能开关和游戏基础配置的修改都会写入审计日志', '')}
    <div class="split">
      <div class="panel"><h2>公告</h2><label class="field"><span>中文</span><textarea id="config-announcement-zh">${esc(announcement.zh || '')}</textarea></label><label class="field"><span>English</span><textarea id="config-announcement-en">${esc(announcement.en || '')}</textarea></label><button class="btn btn--primary" type="button" data-action="save-announcement">保存公告</button></div>
      <div class="panel"><h2>功能开关</h2>${[['aiDrafts', 'AI 草稿生成'], ['csvImport', '题库导入'], ['parentReports', '家长报告'], ['countdownTimer', '答题倒计时']].map(([key, label]) => `<label class="check-field" style="color:var(--ink)"><input id="flag-${key}" type="checkbox" ${flags[key] ? 'checked' : ''} /><span>${label}</span></label>`).join('')}<button class="btn btn--primary" type="button" data-action="save-flags">保存开关</button></div>
    </div>
    <div class="panel"><h2>当前配置</h2><pre class="prewrap mono">${esc(JSON.stringify(state.configs, null, 2))}</pre></div>`;
}

function usersView() {
  return `${top('账号管理', '查看学生、家长和管理员账号；P0 不提供后台重置密码', '<button class="btn btn--sm" type="button" data-action="refresh">刷新</button>')}
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>用户名</th><th>角色</th><th>昵称</th><th>年级</th><th>金币</th><th>星星</th><th>状态</th><th>创建时间</th></tr></thead><tbody>
      ${state.users.length ? state.users.map((row) => `<tr><td class="mono">${esc(row.username)}</td><td>${row.role === 'student' ? '<span class="badge badge--violet">学生</span>' : row.role === 'parent' ? '<span class="badge badge--gold">家长</span>' : '<span class="badge badge--green">管理员</span>'}</td><td>${esc(row.nickname || row.display_name)}</td><td>${row.grade || '-'}</td><td>${row.coins}</td><td>${row.stars}</td><td>${row.status === 'active' ? '正常' : '停用'}</td><td class="small">${formatTime(row.created_at)}</td></tr>`).join('') : '<tr><td colspan="8" class="table-empty">暂无账号</td></tr>'}
    </tbody></table></div></div>`;
}

/* Helpers ----------------------------------------------------------- */

function statusBadge(status) {
  const map = {
    PUBLISHED: ['badge--green', '已发布'],
    DRAFT: ['badge--muted', '草稿'],
    PENDING_REVIEW: ['badge--gold', '待审核'],
    VALIDATED: ['badge--violet', '待确认'],
    COMPLETED: ['badge--green', '已完成'],
    ROLLED_BACK: ['badge--red', '已回滚'],
    FAILED: ['badge--red', '失败'],
    SUCCEEDED: ['badge--green', '成功'],
    QUEUED: ['badge--gold', '排队中'],
    RUNNING: ['badge--gold', '生成中'],
    REJECTED: ['badge--red', '已驳回'],
    APPROVED: ['badge--green', '已通过'],
    ARCHIVED: ['badge--muted', '已下架'],
  };
  const [className, label] = map[status] || ['badge--muted', status];
  return `<span class="badge ${className}">${esc(label)}</span>`;
}

function formatTime(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return value;
  }
}

function openModal(title, body, options = {}) {
  const dialogRoot = document.querySelector('#admin-dialog');
  dialogRoot.innerHTML = `<dialog class="admin-modal"><div class="admin-modal-inner"><div class="admin-modal-head"><h2>${esc(title)}</h2><button class="btn btn--sm" type="button" data-action="close-modal">关闭</button></div><div class="admin-modal-body">${body}</div>${options.onConfirm ? `<div class="admin-modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn--primary" type="button" data-action="modal-confirm">${esc(options.confirmLabel || '保存')}</button></div>` : ''}</div></dialog>`;
  const dialog = dialogRoot.querySelector('dialog');
  dialog.addEventListener('close', () => { dialogRoot.innerHTML = ''; state.modalConfirm = null; });
  dialog.showModal();
  state.modalConfirm = options.onConfirm || null;
}

function closeModal() {
  const dialog = document.querySelector('#admin-dialog dialog');
  if (dialog?.open) dialog.close();
}

/* View loading ------------------------------------------------------ */

async function loadView(view = state.view) {
  state.view = view;
  if (view === 'dashboard') state.dashboard = await api('/admin/dashboard');
  else if (view === 'knowledge') state.knowledge = await api(`/admin/knowledge-points?grade=${state.knowledgeGrade}`);
  else if (view === 'questions') {
    const params = new URLSearchParams();
    params.set('limit', '50');
    params.set('grade', String(state.questionFilters.grade));
    if (state.questionFilters.status) params.set('status', state.questionFilters.status);
    if (state.questionFilters.type) params.set('type', state.questionFilters.type);
    if (state.questionFilters.search) params.set('search', state.questionFilters.search);
    state.questions = await api(`/admin/questions?${params.toString()}`);
  } else if (view === 'imports') state.imports = await api('/admin/imports');
  else if (view === 'ai') {
    state.aiJobs = await api('/admin/ai/jobs');
    if (!state.knowledge.length) state.knowledge = await api(`/admin/knowledge-points?grade=${state.knowledgeGrade}`);
  } else if (view === 'audit') state.audit = await api('/admin/audit-logs?limit=100');
  else if (view === 'configs') state.configs = await api('/admin/configs');
  else if (view === 'users') state.users = await api('/admin/users');
  render();
}

function render() {
  if (!state.user) return renderLogin();
  if (state.view === 'dashboard') shell(dashboardView());
  else if (state.view === 'knowledge') shell(knowledgeView());
  else if (state.view === 'questions') shell(questionsView());
  else if (state.view === 'imports') shell(importsView());
  else if (state.view === 'ai') shell(aiView());
  else if (state.view === 'audit') shell(auditView());
  else if (state.view === 'configs') shell(configsView());
  else if (state.view === 'users') shell(usersView());
  else shell(dashboardView());
}

/* Question editor --------------------------------------------------- */

function parseOptions(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const parts = line.split('|').map((part) => part.trim());
    return {
      key: (parts[0] || String.fromCharCode(65 + index)).toUpperCase(),
      text: { zh: parts[1] || '', en: parts[2] || parts[1] || '' },
    };
  });
}

function optionsToText(options) {
  return (options || []).map((option) => `${option.key}|${option.text?.zh || ''}|${option.text?.en || ''}`).join('\n');
}

function openQuestionEditor(question) {
  const isEdit = Boolean(question?.id);
  const content = question?.content || {};
  const answer = question?.answer || {};
  const knowledgeOptions = state.knowledge.length
    ? state.knowledge.map((row) => `<option value="${esc(row.code)}" ${question?.knowledgeCode === row.code ? 'selected' : ''}>${esc(row.name.zh)}（${esc(row.code)}）</option>`).join('')
    : '<option value="MATH-RJ-G4-T1-NUM-01">多位数乘法与因数 · 基础</option>';
  const type = question?.type || 'SINGLE';
  const answerValue = typeof answer.value === 'boolean' ? String(answer.value) : Array.isArray(answer.value) ? answer.value.join(',') : answer.value || '';
  openModal(isEdit ? `编辑题目 ${question.code}` : '新增题目', `
    <div class="field-row"><label class="field"><span>知识点</span><select id="q-knowledge">${knowledgeOptions}</select></label><label class="field"><span>题型</span><select id="q-type">${['SINGLE', 'JUDGE', 'NUMBER', 'FRACTION', 'MULTI', 'TEXT'].map((item) => `<option value="${item}" ${type === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label></div>
    <div class="field-row"><label class="field"><span>难度</span><select id="q-difficulty">${[1, 2, 3, 4, 5].map((level) => `<option value="${level}" ${(question?.difficulty || 1) === level ? 'selected' : ''}>${level}</option>`).join('')}</select></label><label class="field"><span>答案（选择/判断题填写答案 Key，判断题 true/false）</span><input id="q-answer" value="${esc(answerValue)}" /></label></div>
    <label class="field"><span>题干（中文）</span><textarea id="q-stem-zh">${esc(content.stem?.zh || '')}</textarea></label>
    <label class="field"><span>Stem (English)</span><textarea id="q-stem-en">${esc(content.stem?.en || '')}</textarea></label>
    <label class="field"><span>选项（每行：Key|中文|English；SINGLE/MULTI 使用）</span><textarea id="q-options" style="min-height:96px">${esc(optionsToText(content.options))}</textarea></label>
    <label class="field"><span>提示（每行：中文|English，最多 2 条）</span><textarea id="q-hints">${esc((content.hints || []).map((item) => `${item.zh}|${item.en}`).join('\n'))}</textarea></label>
    <label class="field"><span>解析（中文）</span><textarea id="q-explanation-zh">${esc(content.explanation?.zh || '')}</textarea></label>
    <label class="field"><span>Explanation (English)</span><textarea id="q-explanation-en">${esc(content.explanation?.en || '')}</textarea></label>
    <p class="small muted">题目保存为草稿后，在题库列表中点击“发布”才会进入学生端。</p>
  `, {
    confirmLabel: '保存为草稿',
    onConfirm: async () => {
      const typeValue = document.querySelector('#q-type').value;
      const rawAnswer = document.querySelector('#q-answer').value.trim();
      const options = parseOptions(document.querySelector('#q-options').value);
      let answerValueOut;
      if (typeValue === 'SINGLE') answerValueOut = rawAnswer.toUpperCase();
      else if (typeValue === 'MULTI') answerValueOut = rawAnswer.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
      else if (typeValue === 'JUDGE') answerValueOut = rawAnswer === 'true' || rawAnswer === '正确';
      else answerValueOut = rawAnswer;
      const hints = document.querySelector('#q-hints').value.split('\n').filter(Boolean).slice(0, 2).map((line) => {
        const [zh, en] = line.split('|').map((item) => item.trim());
        return { zh, en: en || zh };
      });
      const body = {
        knowledgeCode: document.querySelector('#q-knowledge').value,
        type: typeValue,
        difficulty: Number(document.querySelector('#q-difficulty').value),
        stem: { zh: document.querySelector('#q-stem-zh').value.trim(), en: document.querySelector('#q-stem-en').value.trim() },
        options,
        answer: { value: answerValueOut },
        hints,
        explanation: { zh: document.querySelector('#q-explanation-zh').value.trim(), en: document.querySelector('#q-explanation-en').value.trim() },
        source: 'MANUAL',
      };
      const saved = isEdit
        ? await api(`/admin/questions/${question.id}`, { method: 'PUT', body })
        : await api('/admin/questions', { method: 'POST', body });
      closeModal();
      await loadView('questions');
      toast(isEdit ? '题目已保存为新版本' : '题目已创建为草稿');
    },
  });
}

/* Knowledge editor -------------------------------------------------- */

function openKnowledgeEditor(row) {
  const isEdit = Boolean(row);
  openModal(isEdit ? `编辑知识点 ${row.code}` : '新增知识点', `
    <div class="field-row"><label class="field"><span>编码</span><input id="k-code" value="${esc(row?.code || '')}" ${isEdit ? 'disabled' : ''} placeholder="MATH-RJ-G4-T1-NUM-04" /></label><label class="field"><span>年级</span><select id="k-grade">${[1, 2, 3, 4, 5, 6].map((grade) => `<option value="${grade}" ${(row?.grade || state.knowledgeGrade) === grade ? 'selected' : ''}>${grade}</option>`).join('')}</select></label></div>
    <div class="field-row"><label class="field"><span>领域</span><select id="k-domain">${['numbers', 'fractions', 'geometry', 'data'].map((domain) => `<option value="${domain}" ${row?.domain === domain ? 'selected' : ''}>${domain}</option>`).join('')}</select></label><label class="field"><span>单元编码</span><input id="k-unit" value="${esc(row?.unitCode || '')}" /></label></div>
    <label class="field"><span>名称（中文）</span><input id="k-name-zh" value="${esc(row?.name?.zh || '')}" /></label>
    <label class="field"><span>Name (English)</span><input id="k-name-en" value="${esc(row?.name?.en || '')}" /></label>
    <div class="field-row"><label class="field"><span>难度</span><select id="k-difficulty">${[1, 2, 3, 4, 5].map((level) => `<option value="${level}" ${(row?.difficulty || 1) === level ? 'selected' : ''}>${level}</option>`).join('')}</select></label><label class="field"><span>状态</span><select id="k-status"><option value="active" ${row?.status !== 'inactive' ? 'selected' : ''}>启用</option><option value="inactive" ${row?.status === 'inactive' ? 'selected' : ''}>停用</option></select></label></div>
  `, {
    confirmLabel: '保存',
    onConfirm: async () => {
      const body = {
        code: document.querySelector('#k-code').value.trim().toUpperCase(),
        grade: Number(document.querySelector('#k-grade').value),
        domain: document.querySelector('#k-domain').value,
        unitCode: document.querySelector('#k-unit').value.trim(),
        name: { zh: document.querySelector('#k-name-zh').value.trim(), en: document.querySelector('#k-name-en').value.trim() },
        difficulty: Number(document.querySelector('#k-difficulty').value),
        status: document.querySelector('#k-status').value,
      };
      if (isEdit) await api(`/admin/knowledge-points/${encodeURIComponent(row.code)}`, { method: 'PUT', body });
      else await api('/admin/knowledge-points', { method: 'POST', body });
      closeModal();
      await loadView('knowledge');
      toast('知识点已保存');
    },
  });
}

/* Import actions ---------------------------------------------------- */

async function previewImport(file) {
  const filename = file.name;
  let payload;
  if (filename.toLowerCase().endsWith('.xlsx')) payload = { filename, base64: await fileToBase64(file) };
  else payload = { filename, text: await file.text() };
  const preview = await api('/admin/imports/preview', { method: 'POST', body: payload });
  state.preview = preview;
  render();
  toast(`校验完成：${preview.stats?.validQuestions || 0} 道有效题，${preview.failed || 0} 个错误行`);
}

async function openAiJob(id) {
  state.aiJob = await api(`/admin/ai/jobs/${id}`);
  render();
  if (state.aiJob.status === 'QUEUED' || state.aiJob.status === 'RUNNING') {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(async () => {
      if (state.view !== 'ai') return;
      await run(async () => {
        state.aiJob = await api(`/admin/ai/jobs/${id}`);
        render();
        if (state.aiJob.status === 'QUEUED' || state.aiJob.status === 'RUNNING') {
          state.pollTimer = setTimeout(() => openAiJob(id), 700);
        }
      });
    }, 700);
  }
}

/* Events ------------------------------------------------------------ */

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'close-modal') return closeModal();
  if (action === 'modal-confirm') {
    const callback = state.modalConfirm;
    if (callback) run(async () => { await callback(); });
    return;
  }
  if (action === 'view') return run(() => loadView(target.dataset.view));
  if (action === 'refresh') return run(() => loadView(state.view));
  if (action === 'admin-login') {
    return run(async () => {
      const result = await api('/auth/login', {
        method: 'POST',
        body: { username: document.querySelector('#admin-username').value.trim(), password: document.querySelector('#admin-password').value },
      });
      if (result.user.role !== 'admin') throw new Error('该账号不是管理员');
      setToken(result.token);
      state.user = result.user;
      await loadView('dashboard');
    });
  }
  if (action === 'admin-logout') {
    clearToken();
    state.user = null;
    return renderLogin();
  }
  if (action === 'knowledge-grade') {
    state.knowledgeGrade = Number(target.dataset.grade);
    return run(() => loadView('knowledge'));
  }
  if (action === 'new-knowledge') return openKnowledgeEditor(null);
  if (action === 'edit-knowledge') return openKnowledgeEditor(state.knowledge.find((row) => row.code === target.dataset.code));
  if (action === 'new-question') {
    if (!state.knowledge.length) return run(async () => { state.knowledge = await api(`/admin/knowledge-points?grade=${state.questionFilters.grade}`); openQuestionEditor(null); });
    return openQuestionEditor(null);
  }
  if (action === 'edit-question') {
    return run(async () => {
      const question = await api(`/admin/questions/${target.dataset.id}`);
      if (!state.knowledge.length) state.knowledge = await api(`/admin/knowledge-points?grade=${question.grade || 4}`);
      openQuestionEditor(question);
    });
  }
  if (action === 'apply-question-filters') {
    state.questionFilters = {
      search: document.querySelector('#filter-search').value.trim(),
      status: document.querySelector('#filter-status').value,
      type: document.querySelector('#filter-type').value,
      grade: Number(document.querySelector('#filter-grade').value),
    };
    return run(() => loadView('questions'));
  }
  if (action === 'question-status') {
    return run(async () => {
      await api(`/admin/questions/${target.dataset.id}/status`, { method: 'POST', body: { action: target.dataset.status } });
      await loadView('questions');
      toast(target.dataset.status === 'publish' ? '题目已发布' : '题目已下架');
    });
  }
  if (action === 'download-template') {
    const format = target.dataset.format;
    return run(() => download(`/admin/imports/template.${format}`, `mathrealms-question-template.${format}`));
  }
  if (action === 'import-commit') {
    return run(async () => {
      const result = await api(`/admin/imports/${target.dataset.id}/commit`, { method: 'POST', body: {} });
      state.preview = await api(`/admin/imports/${target.dataset.id}`);
      await loadView('imports');
      toast(`已入库 ${result.created} 道题（草稿），失败 ${result.failed} 行`);
    });
  }
  if (action === 'import-rollback') {
    return run(async () => {
      const result = await api(`/admin/imports/${target.dataset.id}/rollback`, { method: 'POST', body: {} });
      state.preview = await api(`/admin/imports/${target.dataset.id}`);
      await loadView('imports');
      toast(`已回滚：删除 ${result.removed} 道，归档 ${result.archived} 道`);
    });
  }
  if (action === 'open-import') {
    return run(async () => { state.preview = await api(`/admin/imports/${target.dataset.id}`); state.view = 'imports'; render(); });
  }
  if (action === 'create-ai-job') {
    return run(async () => {
      const job = await api('/admin/ai/jobs', {
        method: 'POST',
        body: {
          knowledgeCode: document.querySelector('#ai-knowledge').value,
          type: document.querySelector('#ai-type').value,
          difficulty: Number(document.querySelector('#ai-difficulty').value),
          count: Number(document.querySelector('#ai-count').value),
        },
      });
      state.aiJob = job;
      state.aiJobs = await api('/admin/ai/jobs');
      render();
      await openAiJob(job.id);
    });
  }
  if (action === 'open-ai-job') return run(() => openAiJob(target.dataset.id));
  if (action === 'ai-approve') {
    return run(async () => {
      await api(`/admin/ai/items/${target.dataset.id}/review`, { method: 'POST', body: { action: 'approve' } });
      state.aiJob = await api(`/admin/ai/jobs/${state.aiJob.id}`);
      render();
      toast('已审核通过并发布到题库');
    });
  }
  if (action === 'ai-reject') {
    openModal('驳回 AI 草稿', `<label class="field"><span>驳回原因</span><textarea id="ai-reject-reason"></textarea></label>`, {
      confirmLabel: '确认驳回',
      onConfirm: async () => {
        await api(`/admin/ai/items/${target.dataset.id}/review`, {
          method: 'POST',
          body: { action: 'reject', reason: document.querySelector('#ai-reject-reason').value.trim() },
        });
        closeModal();
        state.aiJob = await api(`/admin/ai/jobs/${state.aiJob.id}`);
        render();
        toast('已驳回草稿');
      },
    });
    return;
  }
  if (action === 'save-announcement') {
    return run(async () => {
      const value = { zh: document.querySelector('#config-announcement-zh').value.trim(), en: document.querySelector('#config-announcement-en').value.trim() };
      await api('/admin/configs/announcement', { method: 'PUT', body: { value } });
      state.configs = await api('/admin/configs');
      render();
      toast('公告已保存');
    });
  }
  if (action === 'save-flags') {
    return run(async () => {
      const value = {};
      for (const key of ['aiDrafts', 'csvImport', 'parentReports', 'countdownTimer']) value[key] = Boolean(document.querySelector(`#flag-${key}`).checked);
      await api('/admin/configs/feature_flags', { method: 'PUT', body: { value } });
      state.configs = await api('/admin/configs');
      render();
      toast('功能开关已保存');
    });
  }
});

document.addEventListener('change', (event) => {
  if (event.target?.id === 'import-file' && event.target.files?.[0]) {
    run(() => previewImport(event.target.files[0]));
  }
});

/* Boot -------------------------------------------------------------- */

async function boot() {
  if (!getToken()) return renderLogin();
  try {
    const me = await api('/me');
    if (me.user.role !== 'admin') {
      clearToken();
      return renderLogin('该账号没有后台权限，请使用管理员账号登录。');
    }
    state.user = me.user;
    await loadView('dashboard');
  } catch {
    clearToken();
    renderLogin();
  }
}

boot();
