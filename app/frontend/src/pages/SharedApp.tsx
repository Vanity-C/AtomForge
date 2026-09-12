/**
 * Public read-only share page.
 *
 * Anonymous visitors can run the app and browse its source, but never see the
 * owner's account information and cannot edit anything.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Eye, Loader2, MonitorPlay, Code2, ArrowRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BrandMark } from '@/components/AppShell';
import CodePanel from '@/components/CodePanel';
import PreviewFrame from '@/components/PreviewFrame';
import { errorMessage,invoke } from '@/lib/sdk';
import type {Artifact} from '@/lib/studio';
import { fetchSharedProject, type SharedPayload } from '@/lib/projectStore';
import { exportProject } from '@/lib/exportProject';

export default function SharedApp() {
  const { slug } = useParams<{ slug: string }>();
  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [artifact,setArtifact]=useState<Artifact>();
  const [cloudSlug,setCloudSlug]=useState<string|null>(null);
  useEffect(()=>{if(slug)void invoke<{artifact:Artifact|null;cloud_slug:string|null}>({url:'/api/v1/studio/shared/'+encodeURIComponent(slug)+'/artifact',auth:false}).then(r=>{setArtifact(r.artifact||undefined);setCloudSlug(r.cloud_slug);}).catch(()=>{});},[slug]);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [activePath, setActivePath] = useState('App.jsx');

  useEffect(() => {
    if (!slug) return;
    let mounted = true;
    setLoading(true);
    fetchSharedProject(slug)
      .then((data) => {
        if (!mounted) return;
        setPayload(data);
        const entry =
          data.files.find((f) => f.path === (data.entry_file || 'App.jsx')) ?? data.files[0];
        if (entry) setActivePath(entry.path);
      })
      .catch((err) => {
        if (mounted) setError(errorMessage(err, '这个分享链接不存在或已被关闭'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [slug]);

  const files = useMemo(() => payload?.files ?? [], [payload]);

  const handleExport = () => {
    if (!payload || !files.length) return;
    if(slug)void exportProject(payload.name, {slug}).catch(e=>setError(errorMessage(e)));
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在加载分享的应用…
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header className="flex h-14 items-center border-b border-border bg-card px-4">
          <BrandMark />
        </header>
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-7 text-center shadow-sm">
            <h2 className="text-lg font-semibold">无法打开这个应用</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
            <Button asChild className="mt-5 w-full">
              <Link to="/">回到首页</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <BrandMark />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="hidden text-muted-foreground/60 sm:inline">/</span>
          <span className="truncate text-sm font-medium">{payload.name}</span>
          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-normal">
            只读分享
          </Badge>
          <Badge variant="secondary" className="tnum hidden h-5 shrink-0 px-1.5 text-[10px] font-normal sm:inline-flex">
            v{payload.current_version}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tnum hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            <Eye className="h-3.5 w-3.5" />
            {payload.view_count}
          </span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">下载源码</span>
          </Button>
          <Button asChild size="sm" className="h-8 gap-1.5 px-3 text-xs">
            <Link to="/">
              <span className="hidden sm:inline">用 AtomForge 构建</span>
              <span className="sm:hidden">开始构建</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      {payload.description ? (
        <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-2">
          <p className="line-clamp-1 text-xs text-muted-foreground">{payload.description}</p>
        </div>
      ) : null}

      <div className="flex shrink-0 items-center border-b border-border bg-card px-3 py-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'preview' | 'code')}>
          <TabsList className="h-8">
            <TabsTrigger value="preview" className="h-6 gap-1.5 px-3 text-xs">
              <MonitorPlay className="h-3.5 w-3.5" />
              运行预览
            </TabsTrigger>
            <TabsTrigger value="code" className="h-6 gap-1.5 px-3 text-xs">
              <Code2 className="h-3.5 w-3.5" />
              源码
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <main className="min-h-0 flex-1">
        {tab === 'preview' ? (
          <PreviewFrame files={files} artifact={artifact} cloudSlug={cloudSlug} storageKey={`share-${slug}`} />
        ) : (
          <CodePanel key={slug} files={files} activePath={activePath} onSelect={setActivePath} readOnly />
        )}
      </main>
    </div>
  );
}
