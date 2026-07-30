from locust import HttpUser, between, task


class WateslyUser(HttpUser):
    wait_time = between(1, 3)

    @task(3)
    def readiness(self):
        self.client.get("/api/v1/health/ready")

    @task(1)
    def root(self):
        self.client.get("/")
