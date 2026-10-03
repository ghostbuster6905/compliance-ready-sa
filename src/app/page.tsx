const stats = [
  {
    title: "Compliance Score",
    value: "92%",
    description: "Overall company readiness",
    icon: "✓",
  },
  {
    title: "Company Documents",
    value: "18",
    description: "16 valid · 2 expiring",
    icon: "▣",
  },
  {
    title: "Workers",
    value: "24",
    description: "21 compliant · 3 attention",
    icon: "◉",
  },
  {
    title: "Active Projects",
    value: "6",
    description: "2 require attention",
    icon: "⌂",
  },
];

const expiringDocuments = [
  {
    document: "Public Liability Insurance",
    category: "Company",
    expiry: "12 Oct 2026",
    days: "9 days",
    status: "Expiring soon",
  },
  {
    document: "Medical Fitness Certificate",
    category: "Worker",
    expiry: "18 Oct 2026",
    days: "15 days",
    status: "Expiring soon",
  },
  {
    document: "Working at Heights Certificate",
    category: "Worker",
    expiry: "27 Oct 2026",
    days: "24 days",
    status: "Expiring soon",
  },
];

const projects = [
  {
    name: "Sandton Office Development",
    client: "ABC Construction",
    progress: 96,
    status: "Ready",
  },
  {
    name: "Midrand Warehouse",
    client: "BuildPro Projects",
    progress: 82,
    status: "Attention",
  },
  {
    name: "Fourways Retail Centre",
    client: "Urban Developments",
    progress: 74,
    status: "Attention",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden w-64 border-r border-slate-200 bg-white lg:block">
          <div className="flex h-20 items-center border-b border-slate-200 px-6">
            <div>
              <div className="text-xl font-bold tracking-tight">
                Compliance<span className="text-blue-600">Ready</span>
              </div>
              <div className="text-xs text-slate-400">SOUTH AFRICA</div>
            </div>
          </div>

          <nav className="space-y-1 p-4">
            <NavItem label="Dashboard" icon="⌂" active />
            <NavItem label="Company Documents" icon="▣" />
            <NavItem label="Workers" icon="◉" />
            <NavItem label="Projects" icon="▤" />
            <NavItem label="Compliance Packs" icon="▧" />
            <NavItem label="Notifications" icon="♢" />
          </nav>

          <div className="absolute bottom-0 w-64 border-t border-slate-200 p-4">
            <NavItem label="Settings" icon="⚙" />
            <NavItem label="Billing" icon="R" />
          </div>
        </aside>

        {/* Main Content */}
        <section className="flex-1">
          {/* Header */}
          <header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white px-6 lg:px-8">
            <div>
              <h1 className="text-xl font-semibold">Dashboard</h1>
              <p className="text-sm text-slate-500">
                Good morning, welcome back.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <button className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                ♢
              </button>

              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-semibold text-white">
                  GC
                </div>

                <div className="hidden sm:block">
                  <div className="text-sm font-medium">GHOST Construction</div>
                  <div className="text-xs text-slate-500">Owner</div>
                </div>
              </div>
            </div>
          </header>

          <div className="space-y-8 p-6 lg:p-8">
            {/* Welcome */}
            <div>
              <h2 className="text-2xl font-bold">
                Company compliance overview
              </h2>
              <p className="mt-1 text-slate-500">
                Keep your company, workers and projects site-ready.
              </p>
            </div>

            {/* Stats */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <div
                  key={stat.title}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-500">
                      {stat.title}
                    </span>

                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      {stat.icon}
                    </span>
                  </div>

                  <div className="mt-4 text-3xl font-bold">{stat.value}</div>

                  <p className="mt-1 text-sm text-slate-500">
                    {stat.description}
                  </p>
                </div>
              ))}
            </div>

            {/* Main Grid */}
            <div className="grid gap-6 xl:grid-cols-2">
              {/* Expiring Documents */}
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 p-6">
                  <div>
                    <h3 className="font-semibold">Documents needing attention</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Documents approaching their expiry date.
                    </p>
                  </div>

                  <button className="text-sm font-medium text-blue-600 hover:text-blue-700">
                    View all
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {expiringDocuments.map((document) => (
                    <div
                      key={document.document}
                      className="flex items-center justify-between gap-4 p-5"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                          !
                        </div>

                        <div>
                          <div className="text-sm font-medium">
                            {document.document}
                          </div>
                          <div className="text-xs text-slate-500">
                            {document.category} · Expires {document.expiry}
                          </div>
                        </div>
                      </div>

                      <span className="whitespace-nowrap rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                        {document.days}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Projects */}
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 p-6">
                  <div>
                    <h3 className="font-semibold">Project readiness</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Current compliance status by project.
                    </p>
                  </div>

                  <button className="text-sm font-medium text-blue-600 hover:text-blue-700">
                    View all
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {projects.map((project) => (
                    <div key={project.name} className="p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">
                            {project.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {project.client}
                          </div>
                        </div>

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            project.status === "Ready"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {project.status}
                        </span>
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 flex justify-between text-xs">
                          <span className="text-slate-500">
                            Compliance completion
                          </span>
                          <span className="font-medium">
                            {project.progress}%
                          </span>
                        </div>

                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Quick Actions */}
            <section>
              <h3 className="mb-4 font-semibold">Quick actions</h3>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <QuickAction
                  title="Upload document"
                  description="Add a company compliance document"
                />

                <QuickAction
                  title="Add worker"
                  description="Create a new worker profile"
                />

                <QuickAction
                  title="Create project"
                  description="Start a new project checklist"
                />

                <QuickAction
                  title="Generate pack"
                  description="Create a project compliance pack"
                />
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function NavItem({
  label,
  icon,
  active = false,
}: {
  label: string;
  icon: string;
  active?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "bg-blue-50 text-blue-700"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <span className="w-5 text-center">{icon}</span>
      {label}
    </button>
  );
}

function QuickAction({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <button className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        +
      </div>

      <div className="mt-4 font-medium">{title}</div>

      <div className="mt-1 text-sm text-slate-500">{description}</div>
    </button>
  );
}