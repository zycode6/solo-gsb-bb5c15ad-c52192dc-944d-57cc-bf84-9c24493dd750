/** 后端 API 封装 */
async function jsonOrThrow(resp) {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

export const api = {
  health: () => fetch('/api/health').then(jsonOrThrow),

  listFonts: () => fetch('/api/fonts').then(jsonOrThrow),
  deleteFont: (id) => fetch(`/api/fonts/${id}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
  }),
  async uploadFont(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/fonts');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error(xhr.response?.error || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('上传失败（网络错误）'));
      const fd = new FormData();
      fd.append('font', file);
      xhr.send(fd);
    });
  },

  listReports: () => fetch('/api/reports').then(jsonOrThrow),
  getReport: (id) => fetch(`/api/reports/${id}`).then(jsonOrThrow),
  saveReport: (payload) =>
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(jsonOrThrow),
  deleteReport: (id) => fetch(`/api/reports/${id}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
  }),
  exportUrl: (id) => `/api/reports/${id}/export`,
};

/** 浏览器本地下载任意 JSON 对象 */
export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtNum(n) {
  return (n ?? 0).toLocaleString('zh-CN');
}
