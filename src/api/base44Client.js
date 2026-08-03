async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('shiraz:unauthorized'));
    }
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function createEntityApi(resource) {
  return {
    async list() {
      return api(`/api/${resource}`);
    },
    async filter(filters = {}) {
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
      });
      return api(`/api/${resource}?${query.toString()}`);
    },
    async create(input) {
      return api(`/api/${resource}`, { method: 'POST', body: JSON.stringify(input) });
    },
    async update(id, patch) {
      return api(`/api/${resource}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
    },
    async delete(id) {
      return api(`/api/${resource}/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
    },
    async bulkCreate(inputs) {
      if (resource !== 'shifts') throw new Error('Bulk create is only implemented for shifts.');
      return api('/api/shifts/bulk', {
        method: 'POST',
        body: JSON.stringify({ shifts: inputs })
      });
    }
  };
}

export const base44 = {
  auth: {
    async me() {
      return api('/api/me');
    },
    async logout() {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      window.location.assign('/');
    }
  },
  entities: {
    StaffMember: createEntityApi('staff-members'),
    Shift: createEntityApi('shifts'),
    Hinweis: createEntityApi('hinweise')
  },
  functions: {
    async invoke(name, body = {}) {
      const routes = {
        exportToGoogleDrive: ['/api/report/export', 'POST'],
        getDriveFileLink: ['/api/report/link', 'GET'],
        getSetupStatus: ['/api/setup-status', 'GET']
      };
      const route = routes[name];
      if (!route) throw new Error(`Unknown function: ${name}`);
      const [path, method] = route;
      const payload = await api(path, {
        method,
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) })
      });
      return { ...payload, data: payload };
    }
  }
};
