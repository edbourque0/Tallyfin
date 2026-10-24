from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("plans", views.PlanViewSet, basename="plan")

urlpatterns = [
    path("health/", views.HealthView.as_view()),
    path("auth/status/", views.AuthStatusView.as_view()),
    path("auth/setup/", views.SetupView.as_view()),
    path("auth/login/", views.LoginView.as_view()),
    path("auth/logout/", views.LogoutView.as_view()),
    path("auth/password/", views.ChangePasswordView.as_view()),
    path("settings/", views.SettingsView.as_view()),
    path("settings/test/<str:service>/", views.TestConnectionView.as_view()),
    path("settings/test-notification/", views.TestNotificationView.as_view()),
    path("subscribers/", views.SubscriberListView.as_view()),
    path("subscribers/<int:pk>/", views.SubscriberDetailView.as_view()),
    path("subscribers/<int:pk>/payments/", views.RecordPaymentView.as_view()),
    path("subscribers/<int:pk>/activity/", views.SubscriberActivityView.as_view()),
    path("subscribers/<int:pk>/avatar/", views.SubscriberAvatarView.as_view()),
    path("subscribers/<int:pk>/jellyfin-access/", views.JellyfinAccessView.as_view()),
    path("payments/", views.PaymentListView.as_view()),
    path("payments/<int:pk>/", views.PaymentDetailView.as_view()),
    path("dashboard/", views.DashboardView.as_view()),
    path("profitability/", views.ProfitabilityView.as_view()),
    path("sync/", views.SyncView.as_view()),
    path("reminders/", views.RemindersView.as_view()),
]

urlpatterns += router.urls
