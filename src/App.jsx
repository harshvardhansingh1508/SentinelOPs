import { useCallback, useEffect, useState } from 'react'
import api from './services/api'
import './App.css'

const STATUS_OPTIONS = [
  'OPEN',
  'INVESTIGATING',
  'RESOLVED',
  'IGNORED',
]

function formatDateTime(dateString) {
  if (!dateString) return '—'

  const date = new Date(dateString)

  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatLabel(value) {
  if (!value) return 'Unknown'

  return String(value)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getIncidentService(incident) {
  return (
    incident.serviceName ||
    (incident.serviceId
      ? `Service #${incident.serviceId}`
      : incident.source || 'Unassigned')
  )
}

function getIncidentReference(id) {
  return `INC-${String(id).padStart(3, '0')}`
}

function StatCard({ title, value, note, color }) {
  return (
    <div className="stat-card">
      <p>{title}</p>
      <h2 className={color}>{value}</h2>
      <span className="stat-note">{note}</span>
    </div>
  )
}

function LoadingMessage() {
  return (
    <div className="dashboard-message" role="status">
      Loading data from SentinelOps backend...
    </div>
  )
}

function ErrorMessage({ message, onRetry }) {
  return (
    <div className="dashboard-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button className="view-button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

function EmptyMessage({ children }) {
  return <div className="dashboard-message">{children}</div>
}

function IncidentTable({ incidents, search, onStatusChange, updatingId }) {
  const filteredIncidents = incidents.filter((incident) => {
    const searchableText = [
      incident.id,
      incident.title,
      incident.description,
      incident.severity,
      incident.status,
      incident.source,
      getIncidentService(incident),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return searchableText.includes(search.toLowerCase())
  })

  if (filteredIncidents.length === 0) {
    return <EmptyMessage>No incidents match your search.</EmptyMessage>
  }

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Incident ID</th>
            <th>Incident / Service</th>
            <th>Severity</th>
            <th>Status</th>
            <th>Created</th>
            <th>Update Status</th>
          </tr>
        </thead>

        <tbody>
          {filteredIncidents.map((incident) => (
            <tr key={incident.id}>
              <td>{getIncidentReference(incident.id)}</td>

              <td>
                <strong>{incident.title || getIncidentService(incident)}</strong>
                <div className="table-subtext">
                  {getIncidentService(incident)}
                </div>
              </td>

              <td>
                <span
                  className={`badge ${String(
                    incident.severity || 'unknown',
                  ).toLowerCase()}`}
                >
                  {formatLabel(incident.severity)}
                </span>
              </td>

              <td>
                <span
                  className={`badge status-${String(
                    incident.status || 'unknown',
                  ).toLowerCase()}`}
                >
                  {formatLabel(incident.status)}
                </span>
              </td>

              <td>{formatDateTime(incident.createdAt)}</td>

              <td>
                <select
                  className="status-select"
                  aria-label={`Update status for incident ${incident.id}`}
                  value={incident.status || 'OPEN'}
                  disabled={updatingId === incident.id}
                  onChange={(event) =>
                    onStatusChange(incident.id, event.target.value)
                  }
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {formatLabel(status)}
                    </option>
                  ))}
                </select>

                {updatingId === incident.id && (
                  <small className="table-subtext">Updating...</small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [activePage, setActivePage] = useState('Dashboard')
  const [search, setSearch] = useState('')

  const [incidents, setIncidents] = useState([])
  const [services, setServices] = useState([])
  const [summary, setSummary] = useState(null)

  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setPageError('')

    try {
      const results = await Promise.allSettled([
        api.get('/incidents'),
        api.get('/services'),
        api.get('/dashboard/summary'),
      ])

      const failedRequests = results
        .map((result, index) => ({
          result,
          name: ['incidents', 'services', 'dashboard summary'][index],
        }))
        .filter(({ result }) => result.status === 'rejected')

      if (failedRequests.length === results.length) {
        throw new Error(
          'Unable to connect to the backend. Check that Spring Boot is running on port 8080.',
        )
      }

      const [incidentResult, serviceResult, summaryResult] = results

      if (incidentResult.status === 'fulfilled') {
        const data = incidentResult.value.data
        setIncidents(Array.isArray(data) ? data : [])
      } else {
        console.error('Could not load incidents:', incidentResult.reason)
        setPageError('Incidents could not be loaded.')
      }

      if (serviceResult.status === 'fulfilled') {
        const data = serviceResult.value.data
        setServices(Array.isArray(data) ? data : [])
      } else {
        console.error('Could not load services:', serviceResult.reason)
        setPageError((previous) =>
          previous
            ? `${previous} Services could not be loaded.`
            : 'Services could not be loaded.',
        )
      }

      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value.data)
      } else {
        console.error(
          'Could not load dashboard summary:',
          summaryResult.reason,
        )
      }

      setLastUpdated(new Date())
    } catch (error) {
      console.error('Dashboard loading error:', error)

      setPageError(
        error.message ||
          'Unable to load dashboard data. Check the backend connection.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const handleStatusChange = async (incidentId, newStatus) => {
    const previousIncidents = incidents

    setUpdatingId(incidentId)
    setActionError('')

    // Update the visible row immediately.
    setIncidents((current) =>
      current.map((incident) =>
        incident.id === incidentId
          ? { ...incident, status: newStatus }
          : incident,
      ),
    )

    try {
      await api.patch(`/incidents/${incidentId}/status`, {
        status: newStatus,
      })

      // Refresh data so the summary and incident list remain consistent.
      await loadDashboard()
    } catch (error) {
      console.error('Incident status update failed:', error)

      setIncidents(previousIncidents)

      setActionError(
        error.response?.data?.message ||
          'Could not update incident status. Please try again.',
      )
    } finally {
      setUpdatingId(null)
    }
  }

  const totalServices = services.length

  const healthyServices = services.filter(
    (service) =>
      String(service.healthStatus || '').toUpperCase() === 'UP',
  ).length

  const activeIncidents =
    summary?.openIncidents != null &&
    summary?.investigatingIncidents != null
      ? summary.openIncidents + summary.investigatingIncidents
      : incidents.filter((incident) =>
          ['OPEN', 'INVESTIGATING'].includes(
            String(incident.status).toUpperCase(),
          ),
        ).length

  const resolvedIncidents =
    summary?.resolvedIncidents ??
    incidents.filter(
      (incident) =>
        String(incident.status).toUpperCase() === 'RESOLVED',
    ).length

  const criticalIncidents =
    summary?.criticalSeverityIncidents ??
    incidents.filter(
      (incident) =>
        String(incident.severity).toUpperCase() === 'CRITICAL',
    ).length

  const recentIncidents = [...incidents]
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime(),
    )
    .slice(0, 5)

  const resolvedHistory = [...incidents]
    .filter(
      (incident) =>
        String(incident.status).toUpperCase() === 'RESOLVED',
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime(),
    )

  const aiInsights = incidents.filter(
    (incident) =>
      incident.aiAnalysis || incident.recommendation,
  )

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <h2>SentinelOps</h2>

        <p className="menu-title">MAIN MENU</p>

        {['Dashboard', 'Services', 'Incidents', 'Recovery History'].map(
          (page) => (
            <button
              key={page}
              className={`menu-item ${
                activePage === page ? 'active' : ''
              }`}
              onClick={() => setActivePage(page)}
            >
              {page}
            </button>
          ),
        )}

        <div className="sidebar-bottom">
          System Monitoring
          <span>● {loading ? 'Connecting...' : 'API Connected'}</span>
        </div>
      </aside>

      <main className="main-content">
        {pageError && (
          <ErrorMessage
            message={pageError}
            onRetry={loadDashboard}
          />
        )}

        {actionError && (
          <ErrorMessage message={actionError} />
        )}

        {activePage === 'Dashboard' && (
          <>
            <header className="topbar">
              <div>
                <h1>Dashboard Overview</h1>
                <p>Monitor your services and incidents</p>
              </div>

              <div className="user-profile">
                <div className="avatar">H</div>
                <span>Admin</span>
              </div>
            </header>

            <section className="welcome">
              <h2>Welcome to SentinelOps 👋</h2>
              <p>
                Monitor service health, investigate incidents,
                and track recovery outcomes.
              </p>

              {lastUpdated && (
                <small>
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </small>
              )}
            </section>

            {loading && incidents.length === 0 && services.length === 0 ? (
              <LoadingMessage />
            ) : (
              <section className="stats">
                <StatCard
                  title="Total Services"
                  value={totalServices}
                  note="Registered monitored services"
                />

                <StatCard
                  title="Healthy Services"
                  value={healthyServices}
                  note="Services currently UP"
                  color="green"
                />

                <StatCard
                  title="Active Incidents"
                  value={activeIncidents}
                  note="Open or investigating"
                  color="red"
                />

                <StatCard
                  title="Resolved Incidents"
                  value={resolvedIncidents}
                  note="Total incidents resolved"
                  color="blue"
                />
              </section>
            )}

            <section className="incident-section">
              <div className="section-header">
                <div>
                  <h2>Recent Incidents</h2>
                  <p>Latest incidents recorded by the backend</p>
                </div>

                <div className="incident-actions">
                  <input
                    type="text"
                    placeholder="Search incidents..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="search-input"
                  />

                  <button
                    className="view-button"
                    onClick={() => setActivePage('Incidents')}
                  >
                    View All
                  </button>
                </div>
              </div>

              {loading && incidents.length === 0 ? (
                <LoadingMessage />
              ) : (
                <IncidentTable
                  incidents={recentIncidents}
                  search={search}
                  onStatusChange={handleStatusChange}
                  updatingId={updatingId}
                />
              )}
            </section>

            <section className="ai-section">
              <h2>AI Incident Insights</h2>

              {aiInsights.length === 0 ? (
                <EmptyMessage>
                  No AI analysis is available yet. Insights will appear
                  when the backend stores an incident analysis or
                  recommendation.
                </EmptyMessage>
              ) : (
                aiInsights.slice(0, 3).map((incident) => (
                  <div className="ai-card" key={incident.id}>
                    <h3>
                      {incident.title || getIncidentService(incident)}
                    </h3>

                    {incident.aiAnalysis && (
                      <>
                        <span className="ai-label">AI Analysis</span>
                        <p>{incident.aiAnalysis}</p>
                      </>
                    )}

                    {incident.recommendation && (
                      <>
                        <span className="ai-label">
                          Recommendation
                        </span>
                        <p>{incident.recommendation}</p>
                      </>
                    )}
                  </div>
                ))
              )}
            </section>
          </>
        )}

        {activePage === 'Services' && (
          <section className="page-section">
            <header className="topbar">
              <div>
                <h1>Services</h1>
                <p>Monitor registered application services</p>
              </div>

              <button className="view-button" onClick={loadDashboard}>
                Refresh
              </button>
            </header>

            {loading && services.length === 0 ? (
              <LoadingMessage />
            ) : services.length === 0 ? (
              <EmptyMessage>
                No monitored services found. Register a service through
                the backend first.
              </EmptyMessage>
            ) : (
              <div className="service-grid">
                {services.map((service) => (
                  <div className="service-card" key={service.id}>
                    <h3>{service.name}</h3>

                    <p>{service.description || 'No description provided.'}</p>

                    <span
                      className={`badge status-${String(
                        service.healthStatus || 'UNKNOWN',
                      ).toLowerCase()}`}
                    >
                      {formatLabel(service.healthStatus)}
                    </span>

                    <p className="table-subtext">
                      Service ID: {service.id}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activePage === 'Incidents' && (
          <section className="page-section">
            <header className="topbar">
              <div>
                <h1>Incidents</h1>
                <p>Investigate incidents and update their statuses</p>
              </div>

              <button className="view-button" onClick={loadDashboard}>
                Refresh
              </button>
            </header>

            <div className="incident-section">
              <div className="section-header">
                <div>
                  <h2>All Incidents</h2>
                  <p>{incidents.length} incident records loaded</p>
                </div>

                <input
                  type="text"
                  placeholder="Search incidents..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="search-input"
                />
              </div>

              {loading && incidents.length === 0 ? (
                <LoadingMessage />
              ) : (
                <IncidentTable
                  incidents={incidents}
                  search={search}
                  onStatusChange={handleStatusChange}
                  updatingId={updatingId}
                />
              )}
            </div>
          </section>
        )}

        {activePage === 'Recovery History' && (
          <section className="page-section">
            <header className="topbar">
              <div>
                <h1>Recovery History</h1>
                <p>Review incidents marked as resolved</p>
              </div>

              <button className="view-button" onClick={loadDashboard}>
                Refresh
              </button>
            </header>

            {resolvedHistory.length === 0 ? (
              <EmptyMessage>
                No resolved incidents are available yet.
              </EmptyMessage>
            ) : (
              <div className="recovery-list">
                {resolvedHistory.map((incident) => (
                  <div className="recovery-card" key={incident.id}>
                    <div>
                      <h3>
                        {incident.title || getIncidentService(incident)}
                      </h3>

                      <p>{getIncidentReference(incident.id)}</p>
                      <p>{getIncidentService(incident)}</p>
                      <p>
                        Last updated:{' '}
                        {formatDateTime(
                          incident.updatedAt || incident.createdAt,
                        )}
                      </p>
                    </div>

                    <span className="badge status-resolved">
                      Resolved
                    </span>

                    <p className="table-subtext">
                      Incident status is resolved. No separate recovery
                      execution result is currently provided by the API.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export default App