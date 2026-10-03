"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

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