// ── API helper — all calls to the Fleet CRM backend ──────────────────────────
// Token is stored in memory (never localStorage for security)
let token = null; 

export function setToken(t) { token = t; }
export function getToken()  { return token; }
export function clearToken(){ token = null; }
export function isLoggedIn(){ return !!token; }

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Auth ──────────────────────────────────────────────
export const api = {
  login:          (email, password) => req('POST', '/auth/login', { email, password }),
  me:             ()                => req('GET',  '/auth/me'),
  changePassword: (current, next)   => req('POST', '/auth/change-password', { current_password: current, new_password: next }),
  users:          ()                => req('GET',  '/auth/users'),
  addUser:        (data)            => req('POST', '/auth/users', data),
  updateUserPermissions: (id, perms) => req('PUT', `/auth/users/${id}/permissions`, { permissions: perms }),
  deleteUser:     (id)              => req('DELETE', `/auth/users/${id}`),

  // ── Dashboard ───────────────────────────────────────
  dashboard:      ()                => req('GET',  '/dashboard'),
  dashboardDrill: (type, period)    => req('GET',  `/dashboard/activity-drill?type=${type}&period=${period}`),
  tekmetricFleetData:    ()     => req('GET',  '/tekmetric/fleet-data'),
  tekmetricSettings:     ()     => req('GET',  '/tekmetric/settings'),
  saveTekmetricSettings: (data) => req('POST', '/tekmetric/settings', data),

  // ── Follow-ups ──────────────────────────────────────
  followups:         ()             => req('GET',  '/followups'),
  followupsAll:      ()             => req('GET',  '/followups/all'),
  followupCounts:    ()             => req('GET',  '/followups/counts'),
  updateFollowup:    (id, data)     => req('PUT',  `/followups/${id}`, data),
  completeFollowup:  (id, data)     => req('POST', `/followups/${id}/complete`, data),
  deleteFollowup:    (id)           => req('DELETE',`/followups/${id}`),
  refreshFollowups:  ()             => req('POST', '/followups/refresh'),

  // ── Company calling queue ───────────────────────────
  companyQueue:       ()            => req('GET',  '/companies/queue/list'),
  addToCompanyQueue:  (company_id)  => req('POST', '/companies/queue', { company_id }),
  completeCompanyCall:(id, data)    => req('POST', `/companies/queue/${id}/complete`, data),
  removeFromCompanyQueue:(id)       => req('DELETE',`/companies/queue/${id}`),

  // ── Companies ───────────────────────────────────────
  companies:       (params = {})   => req('GET',  `/companies?${new URLSearchParams(params)}`),
  company:         (id)            => req('GET',  `/companies/${id}`),
  createCompany:   (data)          => req('POST', '/companies', data),
  updateCompany:   (id, data)      => req('PUT',  `/companies/${id}`, data),
  companyHistory:  (id)            => req('GET',  `/companies/${id}/history`),
  companyContacts: (id)            => req('GET',  `/companies/${id}/contacts`),
  addContact:      (id, data)      => req('POST', `/companies/${id}/contacts`, data),
  updateContact:   (contactId, d)  => req('PUT',  `/companies/contacts/${contactId}`, d),
  deleteContact:   (contactId)     => req('DELETE',`/companies/contacts/${contactId}`),
  importCallHistory: (companies)   => req('POST', '/companies/import-call-history', { companies }),
  importNewCompanies: (companies)  => req('POST', '/companies/import-new-companies', { companies }),
  nearbyData:      ()              => req('GET',  '/companies/nearby-data'),
  deleteCompany:  (id)          => req('DELETE', `/companies/${id}`),
  mergeCompany:   (id, into_id) => req('POST',   `/companies/${id}/merge/${into_id}`),

  // ── Pipeline ─────────────────────────────────────────────────────────────
  pipelineBoard:    ()             => req('GET',    '/pipeline/board'),
  pipelineCounts:   ()             => req('GET',    '/pipeline/counts'),
  pipelineForecast: ()             => req('GET',    '/pipeline/forecast'),

  // ── Calling queue — upcoming (not just due today) ───────────────────
  callingUpcoming:  ()             => req('GET',    '/pipeline/calling?upcoming=1'),

  // ── Company follow-up date ──────────────────────────────────────────
  companyFollowup:    (id)         => req('GET',    `/companies/${id}/followup`),
  updateFollowupDate: (id, date, action) => req('PUT', `/companies/${id}/followup-date`, { due_date: date, action }),
  geocodeCompany:     (id, latLng) => req('PUT',    `/companies/${id}/geocode`, latLng),
  pipelineStage:    (stage, opts)  => req('GET',    `/pipeline/stage/${stage}?${new URLSearchParams(opts||{})}`),
  callingQueue:     (opts)         => req('GET',    `/pipeline/calling?${new URLSearchParams(opts||{})}`),
  mailQueue:        ()             => req('GET',    '/pipeline/mail'),
  emailQueue:       ()             => req('GET',    '/pipeline/email'),
  pipelineMove:     (id, data)     => req('POST',   `/pipeline/move/${id}`, data),
  pipelineStar:     (id)           => req('POST',   `/pipeline/star/${id}`),
  updateCompanyStatus: (id, status) => req('PUT', `/pipeline/status/${id}`, { status }),
  logMail:          (id, data)     => req('POST',   `/pipeline/log-mail/${id}`, data),
  logEmail:         (id, data)     => req('POST',   `/pipeline/log-email/${id}`, data),
  mailPieces:       ()             => req('GET',    '/pipeline/mail-pieces'),
  createMailPiece:  (data)         => req('POST',   '/pipeline/mail-pieces', data),
  updateMailPiece:  (id, data)     => req('PUT',    `/pipeline/mail-pieces/${id}`, data),
  deleteMailPiece:  (id)           => req('DELETE', `/pipeline/mail-pieces/${id}`),
  emailTemplates:   ()             => req('GET',    '/pipeline/email-templates'),
  createEmailTemplate: (data)      => req('POST',   '/pipeline/email-templates', data),
  updateEmailTemplate: (id, data)  => req('PUT',    `/pipeline/email-templates/${id}`, data),
  deleteEmailTemplate: (id)        => req('DELETE', `/pipeline/email-templates/${id}`),

  // ── Scripts ──────────────────────────────────────────────────────────────
  scripts:          ()           => req('GET',    '/scripts'),
  script:           (id)         => req('GET',    `/scripts/${id}`),
  createScript:     (data)       => req('POST',   '/scripts', data),
  updateScript:     (id, data)   => req('PUT',    `/scripts/${id}`, data),
  deleteScript:     (id)         => req('DELETE', `/scripts/${id}`),

  // Scorecard
  scorecardEnabled:              ()     => req('GET',    '/scorecard/enabled'),
  setScorecardEnabled:           (val)  => req('PUT',    '/scorecard/enabled', { enabled: val }),
  scorecardQuestions:            (sid)  => req('GET',    `/scorecard/questions/${sid}`),
  addScorecardQuestion:          (sid, data) => req('POST', `/scorecard/questions/${sid}`, data),
  updateScorecardQuestion:       (id, data)  => req('PUT',  `/scorecard/questions/${id}`, data),
  deleteScorecardQuestion:       (id)        => req('DELETE', `/scorecard/questions/${id}`),
  reorderScorecardQuestions:     (sid, ids)  => req('POST', `/scorecard/reorder/${sid}`, { ids }),
  scorecardEntries:              (days)      => req('GET',  `/scorecard/entries?days=${days||30}`),
  scorecardDaily:                (days)      => req('GET',  `/scorecard/entries/daily?days=${days||30}`),
  saveScorecardEntry:            (data)      => req('POST', '/scorecard/entries', data),
  updateScorecardEntry:          (id, data)  => req('PUT',    `/scorecard/entries/${id}`, data),

  // Phase-based section questions
  sectionQuestions:    (sid)        => req('GET',    `/scripts/${sid}/section-questions`),
  addSectionQuestion:  (sid, data)  => req('POST',   `/scripts/${sid}/section-questions`, data),
  updateSectionQuestion:(sid,qid,d) => req('PUT',    `/scripts/${sid}/section-questions/${qid}`, d),
  deleteSectionQuestion:(sid,qid)   => req('DELETE', `/scripts/${sid}/section-questions/${qid}`),
  reorderSectionQuestions:(sid,data)=> req('POST',   `/scripts/${sid}/section-questions/reorder`, data),

  // Voicemail tracker
  logVoicemail:        (data)       => req('POST',   '/scripts/voicemail-log', data),
  lastVoicemail:       (entityId)   => req('GET',    `/scripts/voicemail-log/${entityId}`),
  deleteScorecardEntry:          (id)        => req('DELETE', `/scorecard/entries/${id}`),
  quicklogSearch:   (q, type)      => req('GET',  `/quicklog/search?q=${encodeURIComponent(q)}&type=${type||'all'}`),
  quicklogCompany:  (id, data)     => req('POST', `/quicklog/company/${id}`, data),



  // ── Visits ──────────────────────────────────────────
  visits:          ()              => req('GET',  '/visits'),
  visitsAll:       ()              => req('GET',  '/visits/all'),
  updateVisit:     (id, data)      => req('PUT',  `/visits/${id}`, data),
  completeVisit:   (id, data)      => req('POST', `/visits/${id}/complete`, data),
  scheduleVisit:   (company_id)    => req('POST', '/visits/schedule', { company_id }),
  visitQueueStatus:(company_id)    => req('GET',  `/visits/queue-status/${company_id}`),
  searchCompanyName:(q)             => req('GET',  `/companies/search-name?q=${encodeURIComponent(q)}`),
  cancelVisit:     (id)            => req('DELETE',`/visits/${id}`),

  // ── Config ──────────────────────────────────────────
  rules:           ()              => req('GET',  '/config/rules'),
  createRule:      (data)          => req('POST', '/config/rules', data),
  updateRule:      (id, data)      => req('PUT',  `/config/rules/${id}`, data),
  deleteRule:      (id)            => req('DELETE',`/config/rules/${id}`),
  settings:        ()              => req('GET',  '/config/settings'),
  updateSetting:   (key, value)    => req('PUT',  `/config/settings/${key}`, { value }),
  contactTypes:    ()              => req('GET',  '/config/contact-types'),
  backfillFollowups: ()            => req('POST', '/companies/backfill-followups'),
};

// ── Helpers ───────────────────────────────────────────
export function fmtPhone(p) {
  if (!p) return '—';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p;
}

export function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d.includes('T') ? d : d + 'T00:00:00');
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(_) { return '—'; }
}

export function fmtMoney(n) {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}

export function dueDateStatus(dateStr) {
  if (!dateStr) return 'none';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00');
  if (d < today)  return 'overdue';
  if (d.getTime() === today.getTime()) return 'today';
  return 'upcoming';
}
