/**
 * Generation settings: pick the provider/model used by the agent.
 */
import { useEffect, useState } from 'react';
import UsagePanel from '@/components/UsagePanel';
import { Check, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginGate, TopBar, useAuth } from '@/components/AppShell';
import { errorMessage } from '@/lib/sdk';
import { loadProfile, saveProfile } from '@/lib/projectStore';
import {
  DEFAULT_PROFILE,
  MODEL_CATALOGUE,
  type GenerationProfile,
} from '@/lib/agent/modelProvider';

export default function Settings() {
  const { authState, user } = useAuth();
  const [profile, setProfile] = useState<GenerationProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // The profile belongs to the signed-in AtomForge account.
  useEffect(() => {
    if (authState === 'loading') return;
    if (authState === 'anonymous') {
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    loadProfile()
      .then((next) => {
        if (mounted) setProfile(next);
      })
      .catch(() => {
        if (mounted) setProfile(DEFAULT_PROFILE);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [authState]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProfile(profile);
      toast.success('设置已保存', { description: `后续生成将使用 ${profile.model}` });
    } catch (error) {
      toast.error('保存失败', { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar authState={authState} user={user} brandTo="/dashboard" />

      {authState === 'loading' ? (
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-6 h-20 w-full" />
          <Skeleton className="mt-6 h-40 w-full" />
        </main>
      ) : authState === 'anonymous' ? (
        <LoginGate
          title="登录后可配置生成模型"
          description="生成设置会保存在你的 AtomForge 账号下，登录后即可修改。"
        />
      ) : (
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <h1 className="text-2xl font-bold tracking-tight">生成设置</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            选择生成应用时使用的 DeepSeek 模型。你的设置会自动随账号保存，密钥只保存在服务端。
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
            <p className="mt-1 text-sm text-muted-foreground">选择用于代码生成的文本模型。</p>

            {loading ? (
              <div className="mt-4 space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {MODEL_CATALOGUE.map((model) => {
                  const selected = model.id === profile.model;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, model: model.id, provider: model.provider }))}
                      className={`rounded-lg border p-4 text-left transition-colors duration-200 ease-out-quart ${
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
                        {selected ? (
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
                数值越低越稳定保守，越高越有创意但可能出错。
              </p>
              <Slider
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
                checked={profile.autoPreview}
                onCheckedChange={(checked) => setProfile((p) => ({ ...p, autoPreview: checked }))}
              />
            </div>
          </section>

          <div className="mt-6 flex justify-end">
            <Button className="gap-2" disabled={saving || loading} onClick={handleSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              保存设置
            </Button>
          </div>
          <UsagePanel/>
        </main>
      )}
    </div>
  );
}
