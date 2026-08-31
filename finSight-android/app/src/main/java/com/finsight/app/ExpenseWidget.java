package com.finsight.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class ExpenseWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(
            Context context,
            AppWidgetManager appWidgetManager,
            int[] appWidgetIds) {

        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateWidget(
            Context context,
            AppWidgetManager appWidgetManager,
            int appWidgetId) {

        RemoteViews views = new RemoteViews(
                context.getPackageName(),
                R.layout.widget_expense
        );

        Intent voiceIntent = new Intent(
                context,
                VoiceInputActivity.class
        );

        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                100,
                voiceIntent,
                PendingIntent.FLAG_UPDATE_CURRENT |
                        PendingIntent.FLAG_IMMUTABLE
        );

        views.setOnClickPendingIntent(
                R.id.widget_add_expense,
                pendingIntent
        );

        Intent appIntent = new Intent(context, LauncherActivity.class);

        PendingIntent appPendingIntent = PendingIntent.getActivity(
                context,
                101,
                appIntent,
                PendingIntent.FLAG_UPDATE_CURRENT |
                        PendingIntent.FLAG_IMMUTABLE
        );

        views.setOnClickPendingIntent(
                R.id.widget_open_app,
                appPendingIntent
        );

        appWidgetManager.updateAppWidget(
                appWidgetId,
                views
        );
    }
}