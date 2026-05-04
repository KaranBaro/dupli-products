import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    await db.session.deleteMany({ where: { shop } });

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("App uninstall webhook failed:", error);
    return new Response("OK", { status: 200 });
  }
};