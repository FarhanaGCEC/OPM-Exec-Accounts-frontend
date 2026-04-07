import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Plus, Users, Edit, Trash2, Loader2 } from 'lucide-react';
import {
  userService,
  type AppUser,
  type ManageableUserRole,
  normalizeManageableRole,
} from '../services/userService';
import DeleteConfirmationDialog from '../components/DeleteConfirmationDialog';

const ITEMS_PER_PAGE = 10;

export default function UserManagement() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<ManageableUserRole>('user');
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [editRole, setEditRole] = useState<ManageableUserRole>('user');
  const [editPassword, setEditPassword] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const loadUsers = useCallback(async () => {
    setListError(null);
    setLoading(true);
    try {
      const list = await userService.listUsers();
      setUsers(list);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load users';
      setListError(msg);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const totalPages = Math.ceil(users.length / ITEMS_PER_PAGE);
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return users.slice(start, start + ITEMS_PER_PAGE);
  }, [users, currentPage]);



  const openCreateModal = () => {
    setCreateMessage(null);
    setNewUsername('');
    setNewPassword('');
    setNewRole('user');
    setIsCreateModalOpen(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMessage(null);
    if (!newUsername.trim() || newPassword.length < 6) {
      setCreateMessage('Username and password (min 6 characters) are required.');
      return;
    }
    setCreateSubmitting(true);
    try {
      await userService.createUser({
        username: newUsername,
        password: newPassword,
        role: newRole,
      });
      setIsCreateModalOpen(false);
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not create user';
      setCreateMessage(msg);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const closeEditDialog = () => {
    setEditUser(null);
    setEditPassword('');
    setEditError(null);
  };

  const openEditDialog = (u: AppUser) => {
    setEditUser(u);
    setEditRole(normalizeManageableRole(String(u.role)));
    setEditPassword('');
    setEditError(null);
  };

  const handleEditUserSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditError(null);
    if (editPassword.length > 0 && editPassword.length < 6) {
      setEditError('New password must be at least 6 characters, or leave blank to keep the current password.');
      return;
    }
    setEditSubmitting(true);
    try {
      const id = Number(editUser.id);
      const previousRole = normalizeManageableRole(String(editUser.role));
      const roleChanged = editRole !== previousRole;
      const pwd = editPassword.trim();
      const passwordChanged = pwd.length >= 6;

      if (!roleChanged && !passwordChanged) {
        setEditError('Change the role or enter a new password (min 6 characters) to save.');
        return;
      }

      if (roleChanged) {
        await userService.updateRole(id, editRole);
      }
      if (passwordChanged) {
        await userService.updatePassword(id, pwd);
      }

      closeEditDialog();
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update user';
      setEditError(msg);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setListError(null);
    try {
      await userService.deleteUser(Number(deleteTarget.id));
      setDeleteTarget(null);
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete user';
      setListError(msg);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between border-b border-gray-200 shadow-md pb-4">
        <div className="flex items-center gap-3 ml-16">
          <Users className="w-8 h-8 text-gray-900 shrink-0" />
          <h2 className="text-2xl font-bold text-gray-900">User Management</h2>
        </div>
        <Button
          type="button"
          onClick={openCreateModal}
          className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black flex items-center space-x-2 transition-colors rounded-lg mr-4"
          disabled={loading}
        >
          <Plus className="w-4 h-4 text-black" />
          <span>Add New User</span>
        </Button>
      </div>

      {listError && (
        <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{listError}</p>
        </div>
      )}

      <Card className="bg-white border border-gray-200 m-4">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="max-h-[600px] overflow-y-auto relative">
              <table className="w-full caption-bottom text-base border rounded-lg">
                <thead className="sticky top-0 z-20 bg-[#f7c46d] shadow-sm">
                  <tr className="bg-[#f7c46d] border-0">
                    <th className="font-semibold text-black text-sm text-left py-2 px-3 align-middle">ID</th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-3 align-middle">Username</th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-3 align-middle">Role</th>
                    <th className="font-semibold text-black text-sm text-left py-2 px-3 align-middle w-[120px]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="text-center py-8 p-2 align-middle">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                        <p className="text-sm text-gray-500">Loading users...</p>
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-8 p-2 align-middle">
                        <p className="text-sm text-gray-500 mb-1">No users found.</p>
                        <p className="text-sm text-gray-400">Click &quot;Add New User&quot; to create an account.</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedUsers.map((u) => {
                      const roleKey = String(u.role).toLowerCase();
                      const roleClass =
                        roleKey === 'admin'
                          ? 'font-semibold text-amber-900 capitalize'
                          : roleKey === 'accountant'
                            ? 'font-medium text-blue-900 capitalize'
                            : 'text-gray-800 capitalize';
                      return (
                        <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="p-3 align-middle text-sm text-gray-800">{u.id}</td>
                          <td className="p-3 align-middle text-sm font-medium text-gray-900">{u.username}</td>
                          <td className="p-3 align-middle text-sm">
                            <span className={roleClass}>{String(u.role)}</span>
                          </td>
                          <td className="p-3 align-middle">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEditDialog(u)}
                                className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                                title="Edit user"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(u)}
                                className="p-1.5 rounded-md text-red-600 hover:bg-red-50"
                                title="Delete user"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {!loading && users.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-gray-600">
                Page {currentPage} of {totalPages} ({users.length} users)
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateModalOpen} onOpenChange={(o) => !o && setIsCreateModalOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="modal-username">Username</Label>
              <Input
                id="modal-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-password">Password</Label>
              <Input
                id="modal-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={newRole}
                onValueChange={(v) => setNewRole(v as ManageableUserRole)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="accountant">Accountant</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createMessage && (
              <p className={`text-sm ${createMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
                {createMessage}
              </p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setIsCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                disabled={createSubmitting}
              >
                {createSubmitting ? 'Creating…' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editUser} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditUserSave} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="edit-username">Username</Label>
              <Input
                id="edit-username"
                value={editUser?.username ?? ''}
                disabled
                readOnly
                autoComplete="off"
                className="bg-gray-100 text-gray-600 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500">Username cannot be changed.</p>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={editRole}
                onValueChange={(v) => setEditRole(v as ManageableUserRole)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="accountant">Accountant</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">New password</Label>
              <Input
                id="edit-password"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Leave blank to keep current password"
              />
            </div>
            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeEditDialog}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-[#f7c46d] hover:bg-[#c9a82f] text-black"
                disabled={editSubmitting}
              >
                {editSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
        title="Delete user?"
        itemName={deleteTarget?.username}
        isLoading={deleteSubmitting}
        confirmButtonText="Delete"
        loadingButtonText="Deleting..."
      />
    </Layout>
  );
}
