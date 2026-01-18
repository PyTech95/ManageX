using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = Host.CreateDefaultBuilder(args)
    .ConfigureServices(services =>
    {
        services.AddHostedService<Worker>();
        services.AddHttpClient(); // required for IHttpClientFactory
    });

// Only use Windows Service when not debugging
if (!System.Diagnostics.Debugger.IsAttached)
{
    builder.UseWindowsService();
}

var host = builder.Build();
await host.RunAsync();
