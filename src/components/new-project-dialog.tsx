"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Github, FolderOpen, Plug, Download, Plus,
  Lock, Globe, Check,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { GithubOrg } from "@/app/api/github/orgs/route";
import type { GithubRepo } from "@/app/api/github/repos/route";

// ─── Constants ────────────────────────────────────────────────────────────────

const GITIGNORE_TEMPLATES = [
  { value: "", label: "None" },
  { value: "Node", label: "Node" },
  { value: "Python", label: "Python" },
  { value: "Go", label: "Go" },
  { value: "Rust", label: "Rust" },
  { value: "Swift", label: "Swift" },
];

const LICENSES = [
  { value: "", label: "None" },
  { value: "mit", label: "MIT" },
  { value: "apache-2.0", label: "Apache 2.0" },
  { value: "gpl-3.0", label: "GPL 3.0" },
  { value: "agpl-3.0", label: "AGPL 3.0" },
];

const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NewProjectDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"new" | "import">("new");
  const [orgs, setOrgs] = useState<GithubOrg[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);

  // Fetch orgs once on mount
  useEffect(() => {
    if (!open || orgs.length > 0) return;
    setOrgsLoading(true);
    fetch("/api/github/orgs")
      .then(r => r.json())
      .then(d => setOrgs(d.orgs ?? []))
      .catch(() => {})
      .finally(() => setOrgsLoading(false));
  }, [open, orgs.length]);

  function handleClose() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle>New project</DialogTitle>
          {/* Tabs */}
          <div className="flex gap-1 mt-3 border-b border-border">
            {(["new", "import"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-sm -mb-px border-b-2 transition-colors",
                  tab === t
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "new" ? <Plus className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                {t === "new" ? "New repo" : "Import existing"}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="px-6 pt-4 pb-6">
          {tab === "new" ? (
            <NewRepoTab orgs={orgs} orgsLoading={orgsLoading} onClose={handleClose} onDone={() => { handleClose(); router.refresh(); }} />
          ) : (
            <ImportTab orgs={orgs} orgsLoading={orgsLoading} onClose={handleClose} onDone={() => { handleClose(); router.refresh(); }} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── New Repo Tab ─────────────────────────────────────────────────────────────

function NewRepoTab({ orgs, orgsLoading, onClose, onDone }: {
  orgs: GithubOrg[];
  orgsLoading: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<GithubOrg | null>(null);
  const [localBase, setLocalBase] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [readme, setReadme] = useState(true);
  const [gitignore, setGitignore] = useState("Node");
  const [license, setLicense] = useState("mit");
  const [loading, setLoading] = useState(false);

  // Set default org when orgs load
  useEffect(() => {
    if (orgs.length > 0 && !selectedOrg) {
      const personal = orgs.find(o => o.isPersonal) ?? orgs[0];
      setSelectedOrg(personal);
      setLocalBase(personal.localBase ?? "");
    }
  }, [orgs, selectedOrg]);

  const nameValid = name.length === 0 || NAME_RE.test(name);
  const canSubmit = NAME_RE.test(name) && !!selectedOrg && !loading;

  const previewPath = name && localBase ? `${localBase}/${name}` : null;
  const previewGithub = name && selectedOrg ? `github.com/${selectedOrg.login}/${name}` : null;

  async function handleCreate() {
    if (!canSubmit || !selectedOrg) return;
    setLoading(true);
    try {
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          githubOrg: selectedOrg.login,
          localBase: localBase || selectedOrg.localBase,
          private: isPrivate,
          readme,
          gitignore,
          license,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed");
      toast.success(`Created ${name} · port :${data.port}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="proj-name">Repository name</Label>
        <Input
          id="proj-name"
          value={name}
          onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
          placeholder="my-new-app"
          className={cn(!nameValid && name && "border-red-500 focus-visible:ring-red-500")}
          autoFocus
          onKeyDown={e => e.key === "Enter" && handleCreate()}
        />
        {!nameValid && name && (
          <p className="text-xs text-red-400">Lowercase, numbers and hyphens only</p>
        )}
      </div>

      {/* Org */}
      <div className="space-y-1.5">
        <Label>Organisation</Label>
        <Select
          value={selectedOrg?.login ?? ""}
          onValueChange={v => {
            const o = orgs.find(x => x.login === v);
            setSelectedOrg(o ?? null);
            setLocalBase(o?.localBase ?? "");
          }}
          disabled={orgsLoading}
        >
          <SelectTrigger>
            {orgsLoading
              ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</span>
              : <SelectValue placeholder="Select org" />}
          </SelectTrigger>
          <SelectContent>
            {orgs.map(o => (
              <SelectItem key={o.login} value={o.login}>
                <span className="flex items-center gap-2">
                  {o.login}
                  {o.isPersonal && <span className="text-[10px] text-muted-foreground">(personal)</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Local path override if no known mapping */}
      {selectedOrg && !selectedOrg.localBase && (
        <div className="space-y-1.5">
          <Label>Local clone path</Label>
          <Input
            value={localBase}
            onChange={e => setLocalBase(e.target.value)}
            placeholder="/Users/cb/Apps/my-org"
          />
          <p className="text-xs text-muted-foreground">No local path configured for {selectedOrg.login} — enter the parent directory.</p>
        </div>
      )}

      {/* .gitignore + License */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>.gitignore</Label>
          <Select value={gitignore} onValueChange={setGitignore}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              {GITIGNORE_TEMPLATES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>License</Label>
          <Select value={license} onValueChange={setLicense}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              {LICENSES.map(l => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* README + Private */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch id="readme" checked={readme} onCheckedChange={setReadme} />
          <Label htmlFor="readme" className="cursor-pointer font-normal">Add README</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="visibility" checked={isPrivate} onCheckedChange={setIsPrivate} />
          <Label htmlFor="visibility" className="cursor-pointer font-normal">Private</Label>
        </div>
      </div>

      {/* Preview */}
      {name && nameValid && selectedOrg && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 space-y-1.5 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Github className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono truncate">{previewGithub}</span>
            <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded border border-border text-[10px] flex items-center gap-1">
              {isPrivate ? <Lock className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
              {isPrivate ? "private" : "public"}
            </span>
          </div>
          {previewPath && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono truncate">{previewPath}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Plug className="h-3.5 w-3.5 shrink-0" />
            <span>Port auto-assigned</span>
          </div>
          {(readme || gitignore || license) && (
            <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
              {readme && <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">README.md</span>}
              {gitignore && <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">.gitignore ({gitignore})</span>}
              {license && <span className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px]">{LICENSES.find(l => l.value === license)?.label}</span>}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button onClick={handleCreate} disabled={!canSubmit}>
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          {loading ? "Creating…" : "Create project"}
        </Button>
      </div>
    </div>
  );
}

// ─── Import Tab ───────────────────────────────────────────────────────────────

function ImportTab({ orgs, orgsLoading, onClose, onDone }: {
  orgs: GithubOrg[];
  orgsLoading: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [selectedOrg, setSelectedOrg] = useState<GithubOrg | null>(null);
  const [localBase, setLocalBase] = useState("");
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");

  // Set default org
  useEffect(() => {
    if (orgs.length > 0 && !selectedOrg) {
      const personal = orgs.find(o => o.isPersonal) ?? orgs[0];
      setSelectedOrg(personal);
      setLocalBase(personal.localBase ?? "");
    }
  }, [orgs, selectedOrg]);

  const fetchRepos = useCallback(async (org: GithubOrg) => {
    setReposLoading(true);
    setRepos([]);
    setSelectedRepo(null);
    try {
      const url = `/api/github/repos?org=${org.login}${org.isPersonal ? "&personal=1" : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      setRepos(data.repos ?? []);
    } catch {
      toast.error("Failed to load repos");
    } finally {
      setReposLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedOrg) fetchRepos(selectedOrg);
  }, [selectedOrg, fetchRepos]);

  async function handleImport() {
    if (!selectedRepo || !selectedOrg) return;
    const base = localBase || selectedOrg.localBase;
    if (!base) {
      toast.error("No local path — enter a clone directory");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: selectedRepo.fullName, localBase: base }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Import failed");
      if (data.alreadyRegistered) {
        toast.info(`${selectedRepo.name} is already registered`);
      } else {
        toast.success(`Imported ${selectedRepo.name} · port :${data.port}`);
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const filtered = repos.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Org selector */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Organisation</Label>
          <Select
            value={selectedOrg?.login ?? ""}
            onValueChange={v => {
              const o = orgs.find(x => x.login === v);
              setSelectedOrg(o ?? null);
              setLocalBase(o?.localBase ?? "");
            }}
            disabled={orgsLoading}
          >
            <SelectTrigger>
              {orgsLoading
                ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</span>
                : <SelectValue placeholder="Select org" />}
            </SelectTrigger>
            <SelectContent>
              {orgs.map(o => (
                <SelectItem key={o.login} value={o.login}>
                  {o.login}{o.isPersonal ? " (personal)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Filter repos</Label>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
          />
        </div>
      </div>

      {/* Local path override */}
      {selectedOrg && !selectedOrg.localBase && (
        <div className="space-y-1.5">
          <Label>Local clone directory</Label>
          <Input value={localBase} onChange={e => setLocalBase(e.target.value)} placeholder="/Users/cb/Apps/my-org" />
        </div>
      )}

      {/* Repo list */}
      <div className="border border-border rounded-md overflow-hidden max-h-64 overflow-y-auto">
        {reposLoading ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading repos…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">No repos found</div>
        ) : (
          filtered.map((r, i) => (
            <button
              key={r.fullName}
              onClick={() => !r.isAlreadyCloned && setSelectedRepo(r)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                i > 0 && "border-t border-border",
                r.isAlreadyCloned
                  ? "opacity-40 cursor-not-allowed bg-muted/20"
                  : selectedRepo?.fullName === r.fullName
                  ? "bg-accent text-foreground"
                  : "hover:bg-accent/50"
              )}
            >
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block">{r.name}</span>
                {r.description && (
                  <span className="text-[11px] text-muted-foreground truncate block">{r.description}</span>
                )}
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                {r.language && (
                  <span className="text-[10px] text-muted-foreground">{r.language}</span>
                )}
                {r.private
                  ? <Lock className="h-3 w-3 text-muted-foreground/50" />
                  : <Globe className="h-3 w-3 text-muted-foreground/30" />}
                {r.isAlreadyCloned && <Check className="h-3.5 w-3.5 text-green-500" />}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Selected preview */}
      {selectedRepo && localBase && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Github className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono">{selectedRepo.fullName}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono">{localBase}/{selectedRepo.name}</span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose} disabled={importing}>Cancel</Button>
        <Button onClick={handleImport} disabled={!selectedRepo || importing}>
          {importing && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          {importing ? "Importing…" : "Clone & register"}
        </Button>
      </div>
    </div>
  );
}
