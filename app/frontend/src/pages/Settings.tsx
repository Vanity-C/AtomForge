/**
 * Generation settings: pick the provider/model used by the agent.
 */
import { useEffect, useRef, useState } from 'react';
import {Link} from 'react-router-dom';
import UsagePanel from '@/components/UsagePanel';
import { useRecoveringQuery } from '@/hooks/useRecoveringQuery';
import { Check, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginGate, useAuth } from '@/components/AppShell';
import WorkspaceShell from '@/components/WorkspaceShell';
import { errorMessage } from '@/lib/sdk';
import { loadProfile, saveProfile } from '@/lib/projectStore';
import {
  DEFAULT_PROFILE,
  type ModelCatalogue,
  type GenerationProfile,
  type ModelOption,
} from '@/lib/agent/modelProvider';

export default function Settings() {
  const { authState, user } = useAuth();
  const [profile, setProfile] = useState<GenerationProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const savedProfile = useRef<GenerationProfile | null>(null);
  const busy = useRef(false);
  const revision = useRef(0);
  const catalogue = useRecoveringQuery<ModelCatalogue>('/api/v1/studio/models');

  // The profile belongs to the signed-in AtomForge account.
  useEffect(() => {
    const current = ++revision.current;
    savedProfile.current = null;
    busy.current = false;
    setSaving(false);
    setSwitchingModel(null);
    setLoadError('');
    if (authState === 'loading') return;
    if (authState === 'anonymous') {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadProfile()
      .then((next) => {
        if (revision.current === current) {
          savedProfile.current = next;
          setProfile(next);
        }
      })
      .catch((error) => {
        if (revision.current === current) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (revision.current === current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [authState, user?.id, reload]);

  const handleModelSelect = async (model: ModelOption) => {
    if (busy.current || !savedProfile.current || model.available === false || model.id === profile.model) return;
    busy.current = true;
    const current = revision.current;
    setSwitchingModel(model.id);
    try {
      // Keep unsaved slider/switch edits local when saving only the model choice.
      const next = await saveProfile({ ...savedProfile.current, model: model.id, provider: model.provider });
      if (current !== revision.current) return;
      savedProfile.current = next;
      setProfile(p => ({ ...p, model: next.model, provider: next.provider }));
      toast.success('模型已切换', { description: `后续生成将使用 ${model.label}` });
    } catch (error) {
      if (current === revision.current) toast.error('模型切换失败，仍使用原模型', { description: errorMessage(error) });
    } finally {
      if (current === revision.current) {
        busy.current = false;
        setSwitchingModel(null);
      }
    }
  };

  const handleSave = async () => {
    if (busy.current || !savedProfile.current) return;
    busy.current = true;
    const current = revision.current;
    setSaving(true);
    try {
      const next = await saveProfile(profile);
      if (current !== revision.current) return;
      savedProfile.current = next;
      setProfile(next);
      toast.success('其他设置已保存');
    } catch (error) {
      if (current === revision.current) toast.error('保存失败', { description: errorMessage(error) });
    } finally {
      if (current === revision.current) {
        busy.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <WorkspaceShell authState={authState} user={user} title="生成设置">

      {authState === 'loading' ? (
        <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-6 h-20 w-full" />
          <Skeleton className="mt-6 h-40 w-full" />
        </div>
      ) : authState === 'anonymous' ? (
        <LoginGate
          title="登录后可配置生成模型"
          description="生成设置会保存在你的 AtomForge 账号下，登录后即可修改。"
        />
      ) : (
        <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <h1 className="text-2xl font-bold tracking-tight">生成设置</h1>
          <Link to="/agents" className="mt-3 inline-block text-sm text-primary hover:underline">管理智能体 · 定制头像、性格与职责 →</Link>
          <p className="mt-2 text-sm text-muted-foreground">
            选择 DeepSeek 或 GPT 模型。DeepSeek 使用已配置的 API Key，GPT 使用本机已登录的 Codex 账号额度。
          </p>

          <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              当前 Provider：<span className="font-mono text-foreground">{profile.provider}</span>
              ，凭据由平台托管。切换模型不需要重新填写任何密钥。
            </p>
          </div>

          <section className="mt-8">
            <h2 className="text-base font-semibold">生成模型</h2>
            <p className="mt-1 text-sm text-muted-foreground">点击模型即可自动保存，后续生成立即使用新的选择。</p>
            <div className="my-4 flex gap-3 rounded-xl border border-primary/20 bg-accent/50 p-4">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">当前版本推荐 DeepSeek Flash · 性价比首选</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">deepseek-flash 是每位用户的默认模型，适合日常应用生成与多轮修改。你也可以随时切换，已保存的个人选择会被保留。</p>
              </div>
            </div>
            {loadError && <div role="alert" className="my-3 text-sm text-destructive">设置加载失败：{loadError}<Button variant="ghost" size="sm" onClick={() => setReload(n => n + 1)}>重新加载设置</Button></div>}
            <Button variant="ghost" size="sm" disabled={catalogue.refreshing} onClick={() => void catalogue.refresh()}>{catalogue.refreshing ? '正在检测模型…' : '刷新可用模型'}</Button>
            {catalogue.waiting && <p role="status" className="text-sm text-muted-foreground">模型列表暂未同步，请稍后刷新。</p>}
            {catalogue.data?.providers.map(provider => <p key={provider.id} className="mt-2 text-xs text-muted-foreground">{provider.label}：{provider.error || '已连接'}</p>)}

            {loading ? (
              <div className="mt-4 space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {catalogue.data?.items.slice().sort((a, b) => Number(b.id === 'deepseek-flash') - Number(a.id === 'deepseek-flash')).map((model) => {
                  const selected = model.id === profile.model;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      disabled={model.available === false || saving || switchingModel !== null || !!loadError}
                      aria-pressed={selected}
                      aria-busy={switchingModel === model.id}
                      onClick={() => void handleModelSelect(model)}
                      className={`rounded-lg border p-4 text-left transition-colors duration-200 ease-out-quart disabled:opacity-50 ${
                        selected
                          ? 'border-primary bg-accent/60'
                          : 'border-border bg-card hover:md:border-primary/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{model.label}</p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {model.id}
                          </p>
                        </div>
                        {switchingModel === model.id ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" /> : selected ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {model.traits.map((trait) => (
                          <Badge
                            key={trait}
                            variant="secondary"
                            className="h-5 px-1.5 text-[10px] font-normal"
                          >
                            {trait}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{model.note}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-8 space-y-5 rounded-lg border border-border bg-card p-5">
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">创造性</Label>
                <span className="tnum text-sm text-muted-foreground">{profile.temperaturePct}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {profile.provider === 'codex' ? 'GPT 使用 Codex 模型的默认推理设置，创造性滑块仅适用于 DeepSeek。' : '数值越低越稳定保守，越高越有创意但可能出错。'}
              </p>
              <Slider
                disabled={profile.provider === 'codex' || saving || loading || !!loadError}
                value={[profile.temperaturePct]}
                min={0}
                max={100}
                step={5}
                className="mt-4"
                onValueChange={([value]) => setProfile((p) => ({ ...p, temperaturePct: value }))}
              />
            </div>

            <div className="flex items-center justify-between border-t border-border pt-4">
              <div>
                <Label htmlFor="auto-preview" className="text-sm font-medium">
                  生成后自动切到预览
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  关闭后生成完成会停留在代码视图。
                </p>
              </div>
              <Switch
                id="auto-preview"
                disabled={saving || loading || !!loadError}
                checked={profile.autoPreview}
                onCheckedChange={(checked) => setProfile((p) => ({ ...p, autoPreview: checked }))}
              />
            </div>
          </section>

          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" role="status">{switchingModel ? '正在切换模型…' : '模型选择自动保存；下方按钮仅保存其他设置。'}</p>
            <Button className="shrink-0 gap-2" disabled={saving || loading || switchingModel !== null || !!loadError} onClick={handleSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              保存其他设置
            </Button>
          </div>
          <UsagePanel/>
        </div>
      )}
    </WorkspaceShell>
  );
}
