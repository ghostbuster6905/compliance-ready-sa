"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { DocumentHealth, ReadinessLabel } from "@/lib/readiness";
import {
  buildDocumentAlerts,
  companyDocumentStats,
  formatAlertDate,
  loadCompanyDocuments,
  loadProjectsForReadiness,
  loadWorkersWithDocuments,
  overallReadiness,
  projectReadiness,
  workerStats,
  type DocumentAlert,
  type ProjectReadinessSummary,
} from "@/lib/companyOverview";
import { actionNeededCount, loadStoredNotifications } from "@/lib/notifications";

type Profile = {
  id: string;
  company_id: string;
  full_name: string;
  role: string;
};

type Company = {
  id: string;
  name: string;
  subscription_plan: string | null;
};

type AuthState =
  | { status: "loading" }
  | { status: "error"; title: string; message: string; canSignOut: boolean }
  | { status: "ready"; profile: Profile; company: Company };

const roleLabels: Record<string, string> = {
  owner: "Owner",
  compliance_manager: "Compliance Manager",
  site_supervisor: "Site Supervisor",
};

function formatRole(role: string) {
  return (
    roleLabels[role] ??
    role
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

type Overview =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      companyHealth: DocumentHealth;
      workers: ReturnType<typeof workerStats>;
      activeProjects: ProjectReadinessSummary[];
      overall: ReturnType<typeof overallReadiness>;
      alerts: DocumentAlert[];
      actionCount: number;
    };

const readinessBadgeClasses: Record<ReadinessLabel, string> = {
  "Strong readiness": "bg-emerald-50 text-emerald-700",
  "Needs attention": "bg-amber-50 text-amber-700",
  "Action required": "bg-red-50 text-red-700",
};

const DASHBOARD_ALERT_LIMIT = 5;
const DASHBOARD_PROJECT_LIMIT = 5;

export default function Home() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview>({ status: "loading" });
  const [overviewReloadKey, setOverviewReloadKey] = useState(0);

  const companyId = auth.status === "ready" ? auth.profile.company_id : null;
  const userId = auth.status === "ready" ? auth.profile.id : null;

  useEffect(() => {
    if (!companyId || !userId) return;
    let cancelled = false;

    async function loadOverview() {
      // A handful of company-scoped queries in parallel; no per-row queries.
      const [companyDocuments, workers, projects, notifications] =
        await Promise.all([
          loadCompanyDocuments(companyId!),
          loadWorkersWithDocuments(companyId!),
          loadProjectsForReadiness(companyId!),
          loadStoredNotifications(companyId!, userId!),
        ]);
      if (cancelled) return;

      if (!companyDocuments || !workers || !projects) {
        setOverview({ status: "error" });
        return;
      }

      const companyHealth = companyDocumentStats(companyDocuments);
      const workersById = new Map(workers.map((w) => [w.id, w]));
      const activeProjects = projects
        .filter((p) => p.status === "active")
        .map((p) => projectReadiness(p, workersById, companyHealth));
      const alerts = buildDocumentAlerts(companyDocuments, workers);

      setOverview({
        status: "ready",
        companyHealth,
        workers: workerStats(workers),
        activeProjects,
        overall: overallReadiness(activeProjects),
        alerts,
        // Stored notifications are optional here; if they fail to load the
        // bell still reflects the live document alerts.
        actionCount: actionNeededCount(alerts, notifications ?? []),
      });
    }

    loadOverview();

    return () => {
      cancelled = true;
    };
  }, [companyId, userId, overviewReloadKey]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (cancelled) return;

      if (sessionError) {
        setAuth({
          status: "error",
          title: "We couldn't verify your session",
          message: "Please refresh the page or sign in again.",
          canSignOut: false,
        });
        return;
      }

      if (!sessionData.session) {
        router.replace("/login");
        return;
      }

      // getSession only reads local storage; getUser confirms the session
      // with Supabase Auth so a revoked or expired session is rejected.
      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (cancelled) return;

      if (userError || !userData.user) {
        const status = userError?.status ?? 401;
        if (status >= 400 && status < 500) {
          router.replace("/login");
          return;
        }
        setAuth({
          status: "error",
          title: "We couldn't verify your session",
          message: "Please check your connection and refresh the page.",
          canSignOut: false,
        });
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, company_id, full_name, role")
        .eq("id", userData.user.id)
        .maybeSingle<Profile>();
      if (cancelled) return;

      if (profileError) {
        setAuth({
          status: "error",
          title: "We couldn't load your profile",
          message: "Please refresh the page or try again shortly.",
          canSignOut: true,
        });
        return;
      }

      if (!profile) {
        setAuth({
          status: "error",
          title: "Account setup incomplete",
          message:
            "Your account isn't linked to a company yet. Sign out and sign in again to finish setting up your company, or contact support if this continues.",
          canSignOut: true,
        });
        return;
      }

      const { data: company, error: companyError } = await supabase
        .from("companies")
        .select("id, name, subscription_plan")
        .eq("id", profile.company_id)
        .maybeSingle<Company>();
      if (cancelled) return;

      if (companyError || !company) {
        setAuth({
          status: "error",
          title: "We couldn't load your company",
          message: "Please refresh the page or try again shortly.",
          canSignOut: true,
        });
        return;
      }

      setAuth({ status: "ready", profile, company });
    }

    load();

    // Leave the dashboard if the session ends elsewhere (e.g. another tab).
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  async function handleSignOut() {
    setSignOutError(null);
    setSigningOut(true);

    const { error } = await supabase.auth.signOut();

    if (error) {
      setSigningOut(false);
      setSignOutError("We couldn't sign you out. Please try again.");
      return;
    }

    router.replace("/login");
  }

  if (auth.status === "loading") {
    return (
      <AuthScreen>
        <span
          aria-hidden="true"
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
        />
        <p className="mt-4 text-sm text-slate-500">Loading your dashboard…</p>
      </AuthScreen>
    );
  }

  if (auth.status === "error") {
    return (
      <AuthScreen>
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold">{auth.title}</h1>
          <p className="mt-2 text-sm text-slate-500">{auth.message}</p>

          {signOutError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {signOutError}
            </p>
          )}

          {auth.canSignOut && (
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="mt-6 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          )}
        </div>
      </AuthScreen>
    );
  }

  const { profile, company } = auth;

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
            <NavItem label="Company Documents" icon="▣" href="/documents" />
            <NavItem label="Workers" icon="◉" href="/workers" />
            <NavItem label="Projects" icon="▤" href="/projects" />
            <NavItem label="Compliance Packs" icon="▧" href="/compliance-packs" />
            <NavItem label="Notifications" icon="♢" href="/notifications" />
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
              <Link
                href="/notifications"
                aria-label={
                  overview.status === "ready" && overview.actionCount > 0
                    ? `Notifications: ${overview.actionCount} need attention`
                    : "Notifications"
                }
                className="relative rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
              >
                ♢
                {overview.status === "ready" && overview.actionCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                    {overview.actionCount > 99 ? "99+" : overview.actionCount}
                  </span>
                )}
              </Link>

              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-semibold text-white">
                  {getInitials(company.name)}
                </div>

                <div className="hidden sm:block">
                  <div className="text-sm font-medium">{company.name}</div>
                  <div className="text-xs text-slate-500">
                    {profile.full_name} · {formatRole(profile.role)}
                  </div>
                </div>
              </div>

              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </header>

          {signOutError && (
            <div
              role="alert"
              className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700 lg:px-8"
            >
              {signOutError}
            </div>
          )}

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

            {overview.status === "error" && (
              <div
                role="alert"
                className="flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                <span>We couldn&apos;t load your dashboard data.</span>
                <button
                  onClick={() => {
                    setOverview({ status: "loading" });
                    setOverviewReloadKey((key) => key + 1);
                  }}
                  className="font-medium hover:underline"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Stats */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {buildStats(overview).map((stat) => (
                <StatCard key={stat.title} stat={stat} />
              ))}
            </div>
            <p className="-mt-4 text-xs text-slate-500">
              Overall Readiness reflects the project checklists and document
              records configured in ComplianceReady SA. It is not a legal
              compliance certification.
            </p>

            {/* Main Grid */}
            <div className="grid gap-6 xl:grid-cols-2">
              {/* Expiring Documents */}
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 p-6">
                  <div>
                    <h3 className="font-semibold">Documents needing attention</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Expired documents and documents expiring within 30 days.
                    </p>
                  </div>

                  <Link
                    href="/notifications"
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    View all
                  </Link>
                </div>

                {overview.status !== "ready" ? (
                  <PanelMessage
                    text={
                      overview.status === "loading"
                        ? "Loading documents…"
                        : "Document alerts are unavailable."
                    }
                  />
                ) : overview.alerts.length === 0 ? (
                  <PanelMessage text="No expired or expiring documents. Documents expiring within 30 days will appear here." />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {overview.alerts.slice(0, DASHBOARD_ALERT_LIMIT).map((alert) => (
                      <Link
                        key={alert.id}
                        href={alert.workerId ? `/workers/${alert.workerId}` : "/documents"}
                        className="flex items-center justify-between gap-4 p-5 hover:bg-slate-50"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                              alert.status === "expired"
                                ? "bg-red-50 text-red-600"
                                : "bg-amber-50 text-amber-600"
                            }`}
                          >
                            !
                          </div>

                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {alert.documentType}
                            </div>
                            <div className="truncate text-xs text-slate-500">
                              {alert.subjectName} ·{" "}
                              {alert.status === "expired" ? "Expired" : "Expires"}{" "}
                              {formatAlertDate(alert.expiryDate)}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
                            alert.status === "expired"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {alertBadgeText(alert)}
                        </span>
                      </Link>
                    ))}
                    {overview.alerts.length > DASHBOARD_ALERT_LIMIT && (
                      <Link
                        href="/notifications"
                        className="block p-4 text-center text-sm font-medium text-blue-600 hover:bg-slate-50 hover:text-blue-700"
                      >
                        +{overview.alerts.length - DASHBOARD_ALERT_LIMIT} more
                      </Link>
                    )}
                  </div>
                )}
              </section>

              {/* Projects */}
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 p-6">
                  <div>
                    <h3 className="font-semibold">Project readiness</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Readiness of your active projects.
                    </p>
                  </div>

                  <Link
                    href="/projects"
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    View all
                  </Link>
                </div>

                {overview.status !== "ready" ? (
                  <PanelMessage
                    text={
                      overview.status === "loading"
                        ? "Loading projects…"
                        : "Project readiness is unavailable."
                    }
                  />
                ) : overview.activeProjects.length === 0 ? (
                  <PanelMessage text="No active projects. Set a project's status to Active to track its readiness here." />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {sortByReadiness(overview.activeProjects)
                      .slice(0, DASHBOARD_PROJECT_LIMIT)
                      .map((project) => (
                        <Link
                          key={project.id}
                          href={`/projects/${project.id}`}
                          className="block p-5 hover:bg-slate-50"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {project.name}
                              </div>
                              <div className="truncate text-xs text-slate-500">
                                {project.client || "No client set"}
                              </div>
                            </div>

                            <span
                              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
                                project.label
                                  ? readinessBadgeClasses[project.label]
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {project.label ?? "Not configured"}
                            </span>
                          </div>

                          <div className="mt-4">
                            <div className="mb-2 flex justify-between text-xs">
                              <span className="text-slate-500">Project readiness</span>
                              <span className="font-medium">
                                {project.overall === null
                                  ? "Not configured"
                                  : `${project.overall}%`}
                              </span>
                            </div>

                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-blue-600"
                                style={{ width: `${project.overall ?? 0}%` }}
                              />
                            </div>
                          </div>
                        </Link>
                      ))}
                    {overview.activeProjects.length > DASHBOARD_PROJECT_LIMIT && (
                      <Link
                        href="/projects"
                        className="block p-4 text-center text-sm font-medium text-blue-600 hover:bg-slate-50 hover:text-blue-700"
                      >
                        +{overview.activeProjects.length - DASHBOARD_PROJECT_LIMIT} more
                      </Link>
                    )}
                  </div>
                )}
              </section>
            </div>

            {/* Quick Actions */}
            <section>
              <h3 className="mb-4 font-semibold">Quick actions</h3>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <QuickAction
                  href="/documents"
                  title="Upload document"
                  description="Add a company compliance document"
                />

                <QuickAction
                  href="/workers"
                  title="Add worker"
                  description="Create a new worker profile"
                />

                <QuickAction
                  href="/projects"
                  title="Create project"
                  description="Start a new project checklist"
                />

                <QuickAction
                  href="/compliance-packs"
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

function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 text-slate-900">
      <div className="mb-8 text-center">
        <div className="text-2xl font-bold tracking-tight">
          Compliance<span className="text-blue-600">Ready</span>
        </div>
        <div className="text-xs tracking-widest text-slate-400">
          SOUTH AFRICA
        </div>
      </div>
      {children}
    </main>
  );
}

function NavItem({
  label,
  icon,
  active = false,
  href,
}: {
  label: string;
  icon: string;
  active?: boolean;
  href?: string;
}) {
  const className = `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
    active
      ? "bg-blue-50 text-blue-700"
      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
  }`;
  const content = (
    <>
      <span className="w-5 text-center">{icon}</span>
      {label}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <button className={className}>{content}</button>;
}

function QuickAction({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        +
      </div>

      <div className="mt-4 font-medium">{title}</div>

      <div className="mt-1 text-sm text-slate-500">{description}</div>
    </Link>
  );
}

type Stat = {
  title: string;
  value: string;
  description: string;
  icon: string;
  href: string;
  muted?: boolean;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildStats(overview: Overview): Stat[] {
  if (overview.status !== "ready") {
    const description = overview.status === "loading" ? "Loading…" : "Unavailable";
    return [
      { title: "Overall Readiness", icon: "✓", href: "/projects" },
      { title: "Company Documents", icon: "▣", href: "/documents" },
      { title: "Workers", icon: "◉", href: "/workers" },
      { title: "Active Projects", icon: "⌂", href: "/projects" },
    ].map((stat) => ({ ...stat, value: "—", description, muted: true }));
  }

  const { overall, companyHealth, workers, activeProjects } = overview;
  const projectsNeedingAttention = activeProjects.filter(
    (p) => p.overall !== null && p.overall < 90
  ).length;
  const projectsNotConfigured = activeProjects.filter((p) => p.overall === null).length;
  const workersNeedingAttention = workers.withExpired + workers.withExpiring;

  return [
    {
      title: "Overall Readiness",
      icon: "✓",
      href: "/projects",
      value: overall.score === null ? "Not configured" : `${overall.score}%`,
      muted: overall.score === null,
      description:
        overall.score === null
          ? activeProjects.length === 0
            ? "No active projects yet"
            : "No active project has readiness data yet"
          : `${overall.label} · average of ${pluralize(overall.scoredCount, "active project")}`,
    },
    {
      title: "Company Documents",
      icon: "▣",
      href: "/documents",
      value: String(companyHealth.total),
      description:
        companyHealth.total === 0
          ? "No documents recorded yet"
          : `${companyHealth.valid} valid · ${companyHealth.expiring} expiring · ${companyHealth.expired} expired`,
    },
    {
      title: "Workers",
      icon: "◉",
      href: "/workers",
      value: String(workers.active),
      description:
        workers.active + workers.inactive === 0
          ? "No workers added yet"
          : [
              "Active",
              workersNeedingAttention === 0
                ? "None need attention"
                : `${workersNeedingAttention} need attention (${workers.withExpired} expired, ${workers.withExpiring} expiring)`,
              workers.inactive ? `${workers.inactive} inactive` : null,
            ]
              .filter(Boolean)
              .join(" · "),
    },
    {
      title: "Active Projects",
      icon: "⌂",
      href: "/projects",
      value: String(activeProjects.length),
      description:
        activeProjects.length === 0
          ? "No active projects"
          : [
              `${projectsNeedingAttention} need attention`,
              projectsNotConfigured ? `${projectsNotConfigured} not configured` : null,
            ]
              .filter(Boolean)
              .join(" · "),
    },
  ];
}

function StatCard({ stat }: { stat: Stat }) {
  return (
    <Link
      href={stat.href}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{stat.title}</span>

        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          {stat.icon}
        </span>
      </div>

      <div className={`mt-4 font-bold ${stat.muted ? "text-xl text-slate-400" : "text-3xl"}`}>
        {stat.value}
      </div>

      <p className="mt-1 text-sm text-slate-500">{stat.description}</p>
    </Link>
  );
}

function PanelMessage({ text }: { text: string }) {
  return <p className="p-6 text-sm text-slate-500">{text}</p>;
}

function alertBadgeText(alert: DocumentAlert) {
  if (alert.status === "expired") return "Expired";
  if (alert.days === 0) return "Today";
  return alert.days === 1 ? "1 day" : `${alert.days} days`;
}

// Projects needing the most attention first; "Not configured" last.
function sortByReadiness(projects: ProjectReadinessSummary[]) {
  return [...projects].sort((a, b) => {
    if (a.overall === null) return b.overall === null ? 0 : 1;
    if (b.overall === null) return -1;
    return a.overall - b.overall;
  });
}