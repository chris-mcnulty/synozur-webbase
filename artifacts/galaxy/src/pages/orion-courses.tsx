import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { orionApi, type OrionCourse } from "@/lib/orion-api";
import { AlertCircle, BookOpen, Clock, ExternalLink, Search } from "lucide-react";

const ORION_BASE = (import.meta.env.VITE_ORION_BASE_URL ?? "https://orion.synozur.com").replace(/\/$/, "");

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function resolveUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${ORION_BASE}${url}`;
}

function CourseCard({ course }: { course: OrionCourse }) {
  const href = `${ORION_BASE}/courses/${course.slug}`;
  const thumbnail = resolveUrl(course.thumbnail);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group rounded-xl border border-border bg-card overflow-hidden hover:border-violet-500/50 hover:bg-violet-500/5 transition-all flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`orion-course-${course.id}`}
    >
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={course.title}
          className="w-full h-36 object-cover bg-muted"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="w-full h-36 bg-gradient-to-br from-violet-950/60 to-fuchsia-950/60 flex items-center justify-center">
          <BookOpen size={32} className="text-violet-400/40" />
        </div>
      )}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="space-y-1 flex-1">
          <div className="font-semibold text-sm group-hover:text-violet-300 transition-colors leading-snug">
            {course.title}
          </div>
          {course.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{course.description}</p>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Clock size={11} /> {durationLabel(course.estimatedMinutes)}
          </span>
          <span>{course.moduleCount} module{course.moduleCount !== 1 ? "s" : ""}</span>
        </div>

        {(course.tags ?? []).length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {(course.tags ?? []).slice(0, 4).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <span
          className="mt-auto self-start inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 group-hover:text-violet-300 transition-colors"
          data-testid={`link-course-${course.id}`}
        >
          Start course <ExternalLink size={11} />
        </span>
      </div>
    </a>
  );
}

export default function OrionCoursesPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orion-courses"],
    queryFn: () => orionApi.getCourses(),
    staleTime: 5 * 60_000,
  });

  const courses = useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    if (!search.trim()) return arr;
    const q = search.toLowerCase();
    return arr.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q) ||
        (c.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [data, search]);

  return (
    <PortalShell>
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Learning</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Courses and learning paths available to your organization via{" "}
              <a
                href={ORION_BASE}
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 transition-colors"
              >
                Orion <ExternalLink size={11} />
              </a>
              .
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className="text-sm text-muted-foreground">
                {data.length} course{data.length !== 1 ? "s" : ""}
              </span>
            )}
            <a
              href={ORION_BASE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 border border-violet-500/40 hover:border-violet-500/70 rounded-lg px-3 py-1.5 transition-colors"
            >
              Open Orion <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search courses…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            data-testid="input-course-search"
          />
        </div>

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" data-testid="orion-courses-error">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error instanceof Error ? error.message : "Could not load course data. Please try again later."}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 w-full rounded-xl" />
            ))}
          </div>
        ) : !isError && courses.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
              {search.trim()
                ? "No courses match your search."
                : "No courses available yet. Check back once Orion has published learning content for your domain."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="orion-courses-list">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        )}
      </main>
    </PortalShell>
  );
}
