import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Shield, Users, Loader2 } from 'lucide-react';

const ROLES = ['super_admin', 'admin', 'user'];

export default function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const canManageRoles = user?.role === 'super_admin';

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      setUsers(await base44.admin.users.list());
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const updateRole = async (id, role) => {
    setSavingId(id);
    try {
      const updated = await base44.admin.users.updateRole(id, role);
      setUsers((prev) => prev.map((item) => (item.id === id ? updated : item)));
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Unable to update role');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">Manage FOIS users and role permissions</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <Shield className="w-4 h-4 text-primary" />
          {canManageRoles ? 'Super admin controls enabled' : 'Role changes require super admin'}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Name', 'Username', 'Email', 'Role', 'Created'].map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((item) => (
                  <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{item.full_name || item.username}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.username}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.email}</td>
                    <td className="px-4 py-3">
                      {canManageRoles && item.id !== user?.id ? (
                        <select
                          value={item.role}
                          disabled={savingId === item.id}
                          onChange={(event) => updateRole(item.id, event.target.value)}
                          className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none"
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {item.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {item.created_date ? new Date(item.created_date).toLocaleString('en-IN') : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
