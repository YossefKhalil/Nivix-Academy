using System.Net;

var listener = new HttpListener();
listener.Prefixes.Add("http://localhost:8080/");
listener.Start();
Console.WriteLine("listening on :8080");

while (true)
{
    var ctx = listener.GetContext();
    // TODO: route requests
    ctx.Response.StatusCode = 200;
    ctx.Response.Close();
}
