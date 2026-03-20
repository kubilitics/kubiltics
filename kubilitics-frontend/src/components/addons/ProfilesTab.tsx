import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, LayoutGrid, Loader2 } from "lucide-react";
import { useProfiles, useCreateProfile, useUpdateProfile, useDeleteProfile, useCatalog } from "@/hooks/useAddOnCatalog";
import { ClusterProfileCard } from "./ClusterProfileCard";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { Search, Check, Trash2, Edit2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClusterProfile } from "@/types/api/addons";

// ── Profile Form Dialog (Create/Edit) ──────────────────────────────────────────

function ProfileFormDialog({
    open,
    onClose,
    profile,
}: {
    open: boolean;
    onClose: () => void;
    profile?: ClusterProfile;
}) {
    const isEdit = !!profile;
    const [name, setName] = useState(profile?.name || "");
    const [description, setDescription] = useState(profile?.description || "");
    const [selectedAddons, setSelectedAddons] = useState<string[]>(
        profile?.addons.map((a) => a.addon_id) || []
    );
    const [search, setSearch] = useState("");

    const { data: catalogData } = useCatalog(1, 200);
    const catalog = catalogData?.items ?? [];
    const createProfile = useCreateProfile();
    const updateProfile = useUpdateProfile();

    const filteredCatalog = catalog.filter(
        (a) =>
            a.display_name.toLowerCase().includes(search.toLowerCase()) ||
            a.id.toLowerCase().includes(search.toLowerCase())
    );

    const toggleAddon = (id: string) => {
        setSelectedAddons((prev) =>
            prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
        );
    };

    const handleSubmit = async () => {
        if (!name.trim()) return;
        const addons = selectedAddons.map((id) => ({
            addon_id: id,
            namespace: "kube-system", // Sensible default for bootstrap
            upgrade_policy: "auto" as const,
        }));

        if (isEdit && profile) {
            await updateProfile.mutateAsync({
                id: profile.id,
                payload: { name: name.trim(), description: description.trim(), addons },
            });
        } else {
            await createProfile.mutateAsync({
                name: name.trim(),
                description: description.trim(),
                addons,
            });
        }
        handleClose();
    };

    const handleClose = () => {
        if (!isEdit) {
            setName("");
            setDescription("");
            setSelectedAddons([]);
        }
        setSearch("");
        onClose();
    };

    const isPending = createProfile.isPending || updateProfile.isPending;

    return (
        <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
            <DialogContent className="max-w-xl flex flex-col max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit Profile" : "Create Profile"}</DialogTitle>
                    <DialogDescription>
                        Define a set of add-ons to bootstrap clusters.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2 overflow-y-auto pr-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="profile-name">Name</Label>
                            <Input
                                id="profile-name"
                                placeholder="e.g. My Security Stack"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="profile-description">Description</Label>
                            <Input
                                id="profile-description"
                                placeholder="Describe this bundle…"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-sm font-bold">Select Add-ons ({selectedAddons.length})</Label>
                            <div className="relative w-48">
                                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                                <Input
                                    size={1}
                                    placeholder="Search catalog…"
                                    className="pl-8 h-8 text-xs"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto p-1 border rounded-lg bg-slate-50/50">
                            {filteredCatalog?.map((addon) => {
                                const isSelected = selectedAddons.includes(addon.id);
                                return (
                                    <div
                                        key={addon.id}
                                        onClick={() => toggleAddon(addon.id)}
                                        className={cn(
                                            "flex items-center gap-2 p-2 rounded-md border transition-all cursor-pointer text-xs",
                                            isSelected
                                                ? "bg-primary/5 border-primary/20 ring-1 ring-primary/20"
                                                : "bg-white border-slate-100 hover:border-slate-200"
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                                                isSelected
                                                    ? "bg-primary border-primary text-white"
                                                    : "bg-slate-50 border-slate-200"
                                            )}
                                        >
                                            {isSelected && <Check className="h-3 w-3" />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-semibold truncate">{addon.display_name}</div>
                                            <div className="text-[10px] text-slate-400 truncate">{addon.id}</div>
                                        </div>
                                    </div>
                                );
                            })}
                            {filteredCatalog?.length === 0 && (
                                <div className="col-span-2 py-8 text-center text-slate-400 text-xs">
                                    No add-ons found.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 mt-4 pt-4 border-t">
                    <Button variant="outline" onClick={handleClose} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
                        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {isEdit ? "Save Changes" : "Create Profile"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── ProfilesTab ───────────────────────────────────────────────────────────────

export function ProfilesTab() {
    const clusterId = useActiveClusterId();
    const { data: profiles, isLoading, isError } = useProfiles();
    const [createOpen, setCreateOpen] = useState(false);
    const [editProfile, setEditProfile] = useState<ClusterProfile | null>(null);
    const [deleteProfile, setDeleteProfile] = useState<ClusterProfile | null>(null);
    const deleteMutation = useDeleteProfile();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-slate-900">Bootstrap Profiles</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                        Pre-configured add-on bundles to bootstrap clusters in one click.
                    </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Create Profile
                </Button>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Loading profiles…
                </div>
            )}

            {/* Error */}
            {isError && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
                    <LayoutGrid className="h-8 w-8 opacity-30" />
                    <p className="text-sm">Failed to load profiles.</p>
                </div>
            )}

            {/* Grid */}
            {profiles && profiles.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {profiles.map((profile) => (
                        <ClusterProfileCard
                            key={profile.id}
                            profile={profile}
                            clusterId={clusterId}
                            onEdit={profile.is_builtin ? undefined : () => setEditProfile(profile)}
                            onDelete={profile.is_builtin ? undefined : () => setDeleteProfile(profile)}
                        />
                    ))}
                </div>
            )}

            {/* Empty state */}
            {profiles && profiles.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 glass-card bg-slate-50/20 border-slate-100 shadow-sm border-dashed rounded-2xl">
                    <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-6 ring-8 ring-slate-50/50">
                        <LayoutGrid className="h-7 w-7 text-slate-400 opacity-40 shrink-0" />
                    </div>
                    <h3 className="apple-title text-xl">No profiles yet</h3>
                    <p className="apple-description mt-2 max-w-sm text-center">
                        Create a profile to bundle add-ons for one-click cluster bootstrapping.
                    </p>
                    <Button className="mt-6" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        Create Profile
                    </Button>
                </div>
            )}

            <ProfileFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />

            {editProfile && (
                <ProfileFormDialog
                    open={!!editProfile}
                    onClose={() => setEditProfile(null)}
                    profile={editProfile}
                />
            )}

            {deleteProfile && (
                <Dialog open={!!deleteProfile} onOpenChange={(v) => !v && setDeleteProfile(null)}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-red-500" />
                                Delete Profile
                            </DialogTitle>
                            <DialogDescription>
                                Are you sure you want to delete <strong>{deleteProfile.name}</strong>? This action cannot be undone.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="gap-2 pt-4">
                            <Button variant="outline" onClick={() => setDeleteProfile(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={async () => {
                                    await deleteMutation.mutateAsync(deleteProfile.id);
                                    setDeleteProfile(null);
                                }}
                                disabled={deleteMutation.isPending}
                            >
                                {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Delete Profile
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
