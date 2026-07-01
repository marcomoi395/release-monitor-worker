export default {
  async scheduled(controller, env, ctx) {
    console.log("cron triggered", {
      cron: controller.cron,
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
    });
  },

  async fetch() {
    return new Response("release-monitor-worker ready");
  },
} satisfies ExportedHandler;
