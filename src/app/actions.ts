"use server";

import type { Capability, ListItemStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/features/auth/authorization";
import { normalizeEmail } from "@/features/auth/email";
import { isMockAuthEnabled } from "@/features/auth/mode";
import { mockUsers } from "@/features/auth/mock-auth";
import {
  addStore,
  approveMember,
  configureStores,
  disableMember,
  ensureSeedHousehold,
  setMemberStatus,
  updateMember
} from "@/features/household/household.service";
import { addRequest, completeShoppingTrip, markItemOutcome, moveListItemCategory, startShoppingTrip } from "@/features/shopping/shopping.service";

const capabilityValues: Capability[] = ["request", "shop", "administer"];

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function refreshAll() {
  revalidatePath("/list");
  revalidatePath("/shop");
  revalidatePath("/history");
  revalidatePath("/admin");
}

export async function switchMockUserAction(formData: FormData) {
  const email = formString(formData, "email").trim().toLowerCase();
  await switchMockUserEmailAction(email);
}

export async function switchMockUserEmailAction(email: string) {
  if (!isMockAuthEnabled()) throw new Error("Mock user switching is disabled outside mock auth mode.");
  const normalizedEmail = normalizeEmail(email);
  if (!mockUsers.some((user) => user.email === normalizedEmail)) throw new Error("Unknown mock user.");
  const cookieStore = await cookies();
  cookieStore.set("mock_current_user", normalizedEmail, { path: "/", sameSite: "lax", httpOnly: true, secure: false });
  await refreshAll();
}

export async function createHouseholdAction() {
  if (!isMockAuthEnabled()) throw new Error("Request-time household creation is available only in mock auth mode.");
  await ensureSeedHousehold();
  await refreshAll();
}

export async function approveMemberAction(formData: FormData) {
  const admin = await requireCapability("administer");
  const capabilities = capabilityValues.filter((capability) => formData.get(capability) === "on");
  const schema = z.object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1)
  });
  const parsed = schema.parse({
    email: formString(formData, "email"),
    firstName: formString(formData, "firstName"),
    lastName: formString(formData, "lastName")
  });

  await approveMember({
    householdId: admin.householdId,
    email: parsed.email,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    capabilities: capabilities.includes("request") ? capabilities : ["request", ...capabilities]
  });
  revalidatePath("/admin");
}

export async function disableMemberAction(formData: FormData) {
  await requireCapability("administer");
  await disableMember(formString(formData, "membershipId"));
  revalidatePath("/admin");
}

export async function setMemberStatusAction(formData: FormData) {
  await requireCapability("administer");
  const status = formString(formData, "status");
  if (status !== "active" && status !== "disabled") throw new Error("Unknown member status.");
  await setMemberStatus(formString(formData, "membershipId"), status);
  revalidatePath("/admin");
}

export async function updateMemberAction(formData: FormData) {
  await requireCapability("administer");
  const capabilities = capabilityValues.filter((capability) => formData.get(capability) === "on");
  const parsed = z
    .object({
      membershipId: z.string().min(1),
      email: z.string().email(),
      firstName: z.string().min(1),
      lastName: z.string().min(1)
    })
    .parse({
      membershipId: formString(formData, "membershipId"),
      email: formString(formData, "email"),
      firstName: formString(formData, "firstName"),
      lastName: formString(formData, "lastName")
    });

  await updateMember({
    ...parsed,
    capabilities: capabilities.includes("request") ? capabilities : ["request", ...capabilities]
  });
  revalidatePath("/admin");
  redirect("/admin");
}

export async function addStoreAction(formData: FormData) {
  const admin = await requireCapability("administer");
  await addStore(admin.householdId, formString(formData, "name"));
  await refreshAll();
}

export async function configureStoresAction(formData: FormData) {
  const admin = await requireCapability("administer");
  const stores = await prisma.store.findMany({ where: { householdId: admin.householdId } });
  await configureStores(
    admin.householdId,
    stores.map((store) => ({
      id: store.id,
      name: store.name,
      enabled: formData.get(`store-${store.id}`) === "on"
    }))
  );
  await refreshAll();
}

export async function addRequestAction(formData: FormData) {
  const requester = await requireCapability("request");
  const rawText = formString(formData, "rawText");
  const storeId = formString(formData, "storeId") || null;
  if (!rawText.trim()) throw new Error("Add an item before submitting.");

  await addRequest({
    householdId: requester.householdId,
    requestedById: requester.id,
    rawText,
    storeId
  });
  await refreshAll();
}

export async function startShoppingTripAction(formData: FormData) {
  const shopper = await requireCapability("shop");
  const storeId = formString(formData, "storeId");
  if (!storeId) throw new Error("Choose a store before starting a shopping run.");
  await startShoppingTrip({
    householdId: shopper.householdId,
    shopperId: shopper.id,
    storeId
  });
  await refreshAll();
}

export async function moveItemCategoryAction(formData: FormData) {
  const requester = await requireCapability("request");
  const category = formString(formData, "category");
  const itemId = formString(formData, "itemId");
  const recurringStaple = formData.get("recurringStaple") === "on";
  if (!category || !itemId) throw new Error("Choose a category for the item.");
  await moveListItemCategory({
    householdId: requester.householdId,
    listItemId: itemId,
    category,
    recurringStaple
  });
  await refreshAll();
}

export async function markItemOutcomeAction(formData: FormData) {
  const shopper = await requireCapability("shop");
  const outcome = formString(formData, "outcome") as Extract<ListItemStatus, "purchased" | "substituted" | "rejected">;
  await markItemOutcome({
    householdId: shopper.householdId,
    actorId: shopper.id,
    itemId: formString(formData, "itemId"),
    outcome,
    substituteText: formString(formData, "substituteText") || undefined,
    note: formString(formData, "note") || undefined
  });
  await refreshAll();
}

export async function completeShoppingTripAction() {
  const shopper = await requireCapability("shop");
  await completeShoppingTrip(shopper.householdId, shopper.id);
  await refreshAll();
}

export async function markRecurringStapleAction(formData: FormData) {
  await requireCapability("request");
  const itemId = formString(formData, "groceryItemId");
  await prisma.groceryItem.update({
    where: { id: itemId },
    data: { recurringStaple: formData.get("recurringStaple") === "on" }
  });
  await refreshAll();
}
