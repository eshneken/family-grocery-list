import { redirect } from "next/navigation";
import { addStoreAction, approveMemberAction, configureStoresAction, setMemberStatusAction, updateMemberAction } from "@/app/actions";
import { requireCapability } from "@/features/auth/authorization";
import { prisma } from "@/lib/prisma";

export default async function AdminPage() {
  let admin;
  try {
    admin = await requireCapability("administer");
  } catch {
    redirect("/unauthorized");
  }

  const [memberships, stores] = await Promise.all([
    prisma.membership.findMany({
      where: { householdId: admin.householdId },
      include: { user: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.store.findMany({ where: { householdId: admin.householdId }, orderBy: { name: "asc" } })
  ]);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Household access and stores</h2>
          <p>Members are approved by email and can be assigned request, shop, and admin capabilities.</p>
        </div>
      </div>

      <section className="panel">
        <h2>Add family member</h2>
        <form action={approveMemberAction} className="admin-member-form">
          <label className="field">
            First name
            <input name="firstName" required />
          </label>
          <label className="field">
            Last name
            <input name="lastName" required />
          </label>
          <label className="field">
            Google email
            <input name="email" type="email" required />
          </label>
          <fieldset className="checkbox-row">
            <legend>Capabilities</legend>
            <label>
              <input name="request" type="checkbox" defaultChecked />
              Request
            </label>
            <label>
              <input name="shop" type="checkbox" />
              Shop
            </label>
            <label>
              <input name="administer" type="checkbox" />
              Admin
            </label>
          </fieldset>
          <button className="primary-button">Approve member</button>
        </form>
      </section>

      <section className="panel">
        <h2>Members</h2>
        <div className="admin-edit-list">
          {memberships.map((membership) => (
            <details key={membership.id} className="admin-edit-row">
              <summary>
                <span>
                  <strong>{membership.user?.firstName ?? "Pending"} {membership.user?.lastName ?? ""}</strong>
                  <small>{membership.approvedEmail} · {membership.capabilities.join(", ")} · {membership.status}</small>
                </span>
                <form action={setMemberStatusAction}>
                  <input type="hidden" name="membershipId" value={membership.id} />
                  <input type="hidden" name="status" value={membership.status === "disabled" ? "active" : "disabled"} />
                  <button className="secondary-button">{membership.status === "disabled" ? "Enable member" : "Disable member"}</button>
                </form>
              </summary>
              <form action={updateMemberAction} className="admin-edit-form">
                <input type="hidden" name="membershipId" value={membership.id} />
                <label className="field">
                  First name
                  <input name="firstName" defaultValue={membership.user?.firstName ?? ""} required />
                </label>
                <label className="field">
                  Last name
                  <input name="lastName" defaultValue={membership.user?.lastName ?? ""} required />
                </label>
                <label className="field">
                  Google email
                  <input name="email" type="email" defaultValue={membership.approvedEmail} required />
                </label>
                <fieldset className="checkbox-row">
                  <legend>Capabilities</legend>
                  <label>
                    <input name="request" type="checkbox" defaultChecked={membership.capabilities.includes("request")} />
                    Request
                  </label>
                  <label>
                    <input name="shop" type="checkbox" defaultChecked={membership.capabilities.includes("shop")} />
                    Shop
                  </label>
                  <label>
                    <input name="administer" type="checkbox" defaultChecked={membership.capabilities.includes("administer")} />
                    Admin
                  </label>
                </fieldset>
                <button className="primary-button">Save member</button>
              </form>
            </details>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Enabled stores</h2>
        <form action={addStoreAction} className="quick-add add-store-form">
          <label className="field">
            Store name
            <input name="name" required />
          </label>
          <button className="primary-button">Add store</button>
        </form>
        <form action={configureStoresAction} className="checkbox-row">
          {stores.map((store) => (
            <label key={store.id}>
              <input type="checkbox" name={`store-${store.id}`} defaultChecked={store.enabled} />
              {store.name}
            </label>
          ))}
          <button className="primary-button">Save stores</button>
        </form>
      </section>
    </main>
  );
}
