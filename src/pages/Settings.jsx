import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Settings as SettingsIcon, Save, Check } from 'lucide-react';

export default function Settings() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsId, setSettingsId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const me = await base44.auth.me();
        setUser(me);
        const existing = await base44.entities.UserSettings.filter({ user_email: me.email });
        if (existing.length > 0) {
          setSettings(existing[0]);
          setSettingsId(existing[0].id);
        } else {
          setSettings({
            user_email: me.email,
            notify_arrival: true, notify_departure: true, notify_delay: true,
            notify_missing_odr: true, notify_duplicate_odr: true,
            notify_inward: true, notify_outward: false,
            home_station: '', home_division: '',
          });
        }
      } catch (e) { console.error(e); }
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    if (settingsId) {
      await base44.entities.UserSettings.update(settingsId, settings);
    } else {
      const created = await base44.entities.UserSettings.create(settings);
      setSettingsId(created.id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggle = (key) => setSettings(s => ({ ...s, [key]: !s[key] }));

  const NOTIFICATION_TOGGLES = [
    { key: 'notify_inward', label: 'Inward Alerts', desc: 'When freight arrives at your station' },
    { key: 'notify_outward', label: 'Outward Alerts', desc: 'When freight dispatches from your station' },
  ];

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-2xl">
      <div>
        <div className="flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">Notification preferences and station configuration</p>
      </div>

      {/* Profile */}
      {user && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-3">Profile</h3>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-lg font-bold text-primary">{user.full_name?.[0]?.toUpperCase() || 'U'}</span>
            </div>
            <div>
              <div className="font-medium text-foreground">{user.full_name}</div>
              <div className="text-sm text-muted-foreground">{user.email}</div>
              <div className="text-xs text-muted-foreground mt-0.5 capitalize">{user.role}</div>
            </div>
          </div>
        </div>
      )}

      {/* Station config */}
      {settings && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Station Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Home Station</label>
              <input
                value={settings.home_station}
                onChange={e => setSettings(s => ({ ...s, home_station: e.target.value.toUpperCase() }))}
                placeholder="e.g. PUNE"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">Used to classify inward/outward movements</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Home Division</label>
              <input
                value={settings.home_division}
                onChange={e => setSettings(s => ({ ...s, home_division: e.target.value.toUpperCase() }))}
                placeholder="e.g. CCH"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 font-mono"
              />
            </div>
          </div>
        </div>
      )}

      {/* Notification toggles */}
      {settings && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Notification Preferences</h3>
          <div className="space-y-4">
            {NOTIFICATION_TOGGLES.map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
                <button
                  onClick={() => toggle(key)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${settings[key] ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${settings[key] ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {settings && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Settings'}
        </button>
      )}
    </div>
  );
}
